// Step 9: CBRN (chemical agents) and the Advanced Medic scenarios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSession } from "../engine/runner.js";
import { removeBag } from "../engine/circulation.js";
import { checkAirway, insertAirwayItem } from "../engine/airway.js";
import { evaluateGuidance } from "../engine/guidance.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = read("../data/acm-1.4.8.json");
const meds = read("../data/medications-1.4.8.json");
const rules = read("../rules/guidance.json");
const session = (id, seed) => { const scn = read(`../scenarios/${id}.json`); return [createSession(scn, data, meds, { seed, rubric: read(`../${scn.rubric}`) }), scn]; };
const chem = (agent, extra = {}) => createSession({ id: "t", seed: 2, role: "doctor", timeLimit: 900, patient: { conscious: true }, injuries: [],
    cbrn: { agent, until: -1, ppe: {}, ...extra }, loadout: { ACM_Autoinjector_ATNA: 6, ACM_IGel: 1, ACM_BVM: 1, ACM_Ampule_Dimercaprol: 2, ACM_Syringe_5: 2, ACE_WaterBottle: 1,
        G_AirPurifyingRespirator_01_F: 1, ACM_GasMaskFilter: 1 } }, data, meds);
const failedIds = (r) => r.results.filter((x) => x.status === "fail").map((x) => x.check.id).join(", ");
const PARTS = ["head", "body", "leftarm", "rightarm", "leftleg", "rightleg"];

test("exposure: unprotected sarin builds 1.5/s in the cloud; a mask with a filter and a suit block it", () => {
    let s = chem("Sarin");
    s.tick(10);
    assert.equal(s.sim.p.cbrn.buildup.Sarin, 15);
    s = chem("Sarin", { ppe: { mask: true, suit: true } });
    s.tick(10);
    assert.equal(s.sim.p.cbrn.buildup.Sarin, 0);
    assert.equal(s.sim.p.cbrn.ppe.filter, 590, "the filter depletes 1 per second in the cloud");
    s = chem("Sarin", { ppe: { mask: true } });
    s.tick(10);
    assert.equal(s.sim.p.cbrn.buildup.Sarin, 5, "masked but no suit: skin absorption 0.5/s");
});

test("sarin: spasm at 60 stops breathing (BVM cannot help) until 3+ atropine is active", () => {
    const s = chem("Sarin", { until: 0, buildup: { Sarin: 65 } });
    s.tick(2);
    assert.ok(s.sim.p.cbrn.spasm && s.sim.p.unconscious);
    s.act("insertigel", "head"); s.act("usebvm", "head");
    s.tick(10);
    assert.equal(s.sim.p.rr, 0, "airway spasm: no respiration even with the BVM");
    for (let i = 0; i < 4; i++) s.act("atna_autoinjector", "leftleg");
    s.tick(60);
    assert.ok(s.sim.p.rr > 0, "3+ atropine: breathing despite the spasm");
    const before = s.sim.p.cbrn.buildup.Sarin;
    s.tick(60);
    assert.ok(s.sim.p.cbrn.buildup.Sarin < before - 4, "atropine loop removes sarin");
});

test("lewisite: burns while exposed, capillary damage above 50 lowers BP and bleeds; dimercaprol IM clears it", () => {
    const s = chem("Lewisite", { buildup: { Lewisite: 52 } });
    const p = s.sim.p;
    s.tick(1);
    s.act("dragoutofcloud", "body"); // 20 s more in the cloud: buildup passes 70, where capillary damage starts building
    assert.ok(PARTS.some((x) => p.openWounds[x].some((w) => w.type === "ChemicalBurn")));
    assert.ok(p.cbrn.capillary > 0);
    assert.ok(p.cbrn.inflammation > 0, "unfiltered breathing above 30 inflames the airway");
    const lw = p.cbrn.buildup.Lewisite;
    s.draw(5, "Dimercaprol", 3);
    s.act("dimercaprol_5_im", "leftleg");
    s.tick(120);
    assert.ok(p.cbrn.buildup.Lewisite < lw - 20);
});

test("airway inflammation: Check Airway reports it, i-gel blocked above 40, airway closes at 100", () => {
    const s = chem("Chlorine", { until: 0 });
    const p = s.sim.p;
    p.cbrn.inflammation = 45;
    s.sim.criticalVitals();
    assert.match(checkAirway(s.sim).hint.join(" "), /significant inflammation/);
    assert.equal(insertAirwayItem(s.sim, "SGA").ok, false);
    p.cbrn.inflammation = 100;
    s.tick(1);
    assert.equal(p.rr, 0);
});

test("wash eyes cures CS blindness; chlorine above 50 makes it permanent", () => {
    let s = chem("CS");
    s.tick(110);
    assert.ok(s.sim.p.cbrn.blind);
    s.act("dragoutofcloud", "body");
    assert.ok(!s.act("washeyes", "head").error);
    assert.equal(s.sim.p.cbrn.blind, false);
    s = chem("Chlorine", { buildup: { Chlorine: 45 } });
    s.tick(8);
    assert.ok(s.sim.p.cbrn.permBlind.Chlorine);
    assert.equal(s.catalogue.find((a) => a.id === "washeyes").show(s.ctx, "head"), false);
});

test("putting a gas mask on an unconscious casualty in the cloud stops inhalation", () => {
    const s = chem("Sarin", { buildup: { Sarin: 61 } });
    s.tick(1);
    assert.ok(s.sim.p.unconscious);
    assert.ok(!s.act("putongasmask", "head").error);
    const b = s.sim.p.cbrn.buildup.Sarin;
    s.tick(10);
    assert.ok(s.sim.p.cbrn.buildup.Sarin - b <= 5 + 1e-9, "only skin absorption (0.5/s) remains");
});

for (const [id, play] of Object.entries({
    "am1-massive-transfusion": (s) => {
        s.act("insertiv_14_middle", "leftarm");
        s.addBag("leftarm", 1, true, "ACM_BloodBag_B_500"); s.addBag("leftarm", 1, true, "ACM_BloodBag_B_500");
        for (let k = 0; k < 12; k++) for (const part of PARTS) if ((s.sim.p.openWounds[part] || []).some((w) => w.count > 0 && w.bleeding > 0)) for (const b of ["emergencytraumadressing", "pressurebandage", "elasticbandage"]) if (!s.act(b, part).error) break;
        s.draw(10, "TXA", 10); s.act("txa_10_iv", "leftarm");
        s.until(240); s.addBag("leftarm", 1, true, "ACM_BloodBag_ON_500"); s.addBag("leftarm", 1, true, "ACM_BloodBag_ON_500");
        s.until(420); s.draw(10, "CalciumChloride", 10); s.act("calciumchloride_10_iv", "leftarm");
    },
    "am1-incompatible-blood": (s) => { s.act("checkdogtags", "head"); s.tick(5); removeBag(s.sim, 0); s.tick(5); s.addBag("rightarm", 1, true, "ACM_BloodBag_AN_500"); },
    "am2-reversible-arrest": (s) => {
        s.act("applychestseal", "body"); s.act("performncd", "body"); s.act("insertio_ez", "rightarm");
        s.addBag("rightarm", 0, false, "ACM_BloodBag_ON_500"); s.addBag("rightarm", 0, false, "ACM_BloodBag_ON_500");
        s.act("insertigel", "head"); s.act("cpr", "body");
        for (let i = 0; i < 420 && s.sim.p.cardiacArrest; i++) s.tick(1);
        s.sim.act("cprStop");
    },
    "am4-nerve-agent": (s) => {
        for (let i = 0; i < 4; i++) s.act("atna_autoinjector", "leftleg");
        s.act("insertigel", "head"); s.act("usebvm", "head");
        for (let i = 0; i < 660; i++) { s.tick(1); if (s.sim.p.bvm && s.sim.p.t % 6 === 0) s.sim.act("bvmBreath"); if (i === 60) s.act("midazolam_autoinjector", "rightleg"); }
        s.sim.act("bvmStop");
    },
    "am4-blister-agent": (s) => { s.act("dragoutofcloud", "body"); s.draw(5, "Dimercaprol", 3); s.act("dimercaprol_5_im", "leftleg"); s.act("washeyes", "head"); },
})) {
    test(`${id}: fatal untreated; textbook treatment is a GO`, () => {
        let [s, scn] = session(id);
        s.until(scn.timeLimit);
        assert.equal(s.sim.p.alive, false);
        [s, scn] = session(id);
        s.tick(2);
        play(s);
        s.until(scn.timeLimit);
        const r = s.score();
        assert.equal(r.passed, true, failedIds(r));
    });
}

test("guidance: sarin spasm at Advanced; a casualty in the cloud is moved first at Basic", () => {
    let [s] = session("am4-nerve-agent");
    s.tick(2);
    assert.equal(evaluateGuidance(rules, s.sim, { depth: 3, level: 2 })[0].rule, "x-spasm");
    [s] = session("am4-blister-agent");
    s.tick(1);
    assert.equal(evaluateGuidance(rules, s.sim, { depth: 1, level: 2 })[0].rule, "cbrn-cloud-awake");
});
