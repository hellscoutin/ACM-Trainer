// Pharmacology (syringes, overdose, special drug effects), AED, lying state, CM-4/CM-5 scenarios and rubrics.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Simulation } from "../engine/sim.js";
import { createSession } from "../engine/runner.js";
import { medicationCount, isOverdosed, nauseaEffect } from "../engine/pharmacology.js";
import { aedState } from "../engine/aed.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = read("../data/acm-1.4.8.json");
const meds = read("../data/medications-1.4.8.json");
const sim = (seed = 1, o = {}) => new Simulation({ data, meds, seed, ...o });
const session = (loadout, extra = {}) => createSession({ id: "t", seed: extra.seed ?? 3, role: "medic", patient: {}, loadout, timeLimit: 900, ...extra }, data, meds, { rubric: { checks: [] } });
const scenario = (id, seed) => { const scn = read(`../scenarios/${id}.json`); return createSession(scn, data, meds, { seed, rubric: read(`../${scn.rubric}`) }); };
const failed = (r) => r.results.filter((x) => x.status === "fail").map((x) => x.check.id);

test("drawing uses the whole vial and an empty syringe; dose = ml x concentration", () => {
    const s = session({ ACM_Syringe_10: 1, ACM_Vial_Morphine: 1 });
    const r = s.draw(10, "Morphine", 5); // more than the 2 ml vial holds
    assert.equal(r.ok, true);
    assert.equal(r.syringe.ml, 2);
    assert.equal(s.ctx.inventory.ACM_Vial_Morphine, 0);
    assert.equal(s.ctx.inventory.ACM_Syringe_10, 0);
});

test("IV push needs IV or IO access on that part; IM works anywhere and hurts", () => {
    const s = session({ ACM_Syringe_10: 2, ACM_Vial_Epinephrine: 2, ACM_IV_16g: 1 });
    s.draw(10, "Epinephrine", 1);
    const fail = s.act("epinephrine_10_iv", "leftarm");
    assert.match(fail.hint.join(" "), /no IV access/);
    assert.equal(s.ctx.syringes.length, 1); // syringe kept
    s.tick(5);
    s.act("insertiv_16_middle", "leftarm");
    s.act("epinephrine_10_iv", "leftarm");
    assert.ok(s.sim.p.meds.some((m) => m.name === "Epinephrine_IV"));
    assert.equal(s.ctx.inventory.ACM_Syringe_10, 2); // reusable syringes come back
    s.draw(10, "Epinephrine", 1);
    const before = s.sim.p.pain;
    s.act("epinephrine_10_im", "rightleg");
    assert.ok(s.sim.p.meds.some((m) => m.name === "Epinephrine"));
    assert.ok(s.sim.p.pain >= Math.max(before, 0.1) - 1e-9);
});

test("IM TXA has no configured class in ACM 1.4.8: no effect", () => {
    const s = session({ ACM_Syringe_10: 1, ACM_Vial_TXA: 1 });
    s.draw(10, "TXA", 10);
    s.act("txa_10_im", "leftleg");
    assert.equal(s.sim.p.meds.some((m) => m.name.startsWith("TXA")), false);
});

test("morphine overdose: respiratory depression; naloxone removes the overdose effect but not the morphine", () => {
    const s = sim(4);
    // ACM checks the current effect (near 0 just after a push) or this one dose, so doses must be spaced to count
    for (let k = 0; k < 4; k++) { s.act("medication", { part: "leftarm", name: "Morphine_IV", dose: 10, iv: true }); s.run(20); }
    s.run(90);
    assert.ok(s.events.some((e) => e.event === "overdose"));
    assert.ok(medicationCount(s.p, "Overdose_Opioid") > 0);
    assert.equal(isOverdosed(s), true);
    s.act("medication", { part: "head", name: "Naloxone", dose: 4 });
    assert.equal(s.p.meds.some((m) => m.name === "Overdose_Opioid"), false);
    assert.ok(s.p.meds.some((m) => m.name === "Morphine_IV"));
});

test("amiodarone does not roll its own restart (ACM never dispatches its handler)", () => {
    const s = sim(5);
    s.p.targetRhythm = "VF";
    s.fatalVitals();
    s.act("medication", { part: "body", name: "Amiodarone_IV", dose: 300, iv: true });
    s.run(120); // no CPR, no shock
    assert.equal(s.p.cardiacArrest, true);
    assert.equal(s.events.some((e) => e.event === "rosc"), false);
});

test("adenosine converts stable VT: brief asystole, then sinus", () => {
    const s = sim(6);
    s.run(5);
    s.p.rhythm = "VT";
    s.act("medication", { part: "leftarm", name: "Adenosine_IV", dose: 12, iv: true });
    s.run(70);
    assert.ok(s.events.some((e) => e.event === "cardiacArrest"));
    s.run(200);
    assert.equal(s.p.rhythm, "Sinus");
    assert.equal(s.p.cardiacArrest, false);
});

test("calcium: 1 g adds 2.5 units the first time, 2 after", () => {
    const s = sim(7);
    s.act("medication", { part: "leftarm", name: "CalciumChloride_IV", dose: 1000, iv: true });
    assert.equal(s.p.calcium, 2.5);
    s.act("medication", { part: "leftarm", name: "CalciumChloride_IV", dose: 1000, iv: true });
    assert.equal(s.p.calcium, 4.5);
});

test("opioids add nausea; ondansetron suppresses it", () => {
    const s = sim(8);
    s.act("medication", { part: "leftarm", name: "Morphine_IV", dose: 8, iv: true });
    s.run(60);
    const n = nauseaEffect(s.p);
    assert.ok(n > 0.5, `nausea ${n}`);
    s.act("medication", { part: "leftarm", name: "Ondansetron_IV", dose: 4, iv: true });
    s.run(30);
    assert.ok(nauseaEffect(s.p) < n);
});

test("AED: analyze advises a shock for VF, charges, and cancels the charge after 30 s", () => {
    const s = session({ ACM_AED: 1 });
    s.sim.p.targetRhythm = "VF";
    s.sim.fatalVitals();
    s.act("aed_applypads", "body");
    s.act("aed_analyzerhythm", "body");
    s.tick(25);
    const a = aedState(s.sim.p);
    assert.equal(a.charged, true);
    assert.equal(a.message, "PUSH TO SHOCK");
    s.tick(32);
    assert.equal(a.charged, false);
});

test("AED: no shock advised for asystole; CPR during analysis is detected as motion", () => {
    let s = session({ ACM_AED: 1 });
    s.sim.p.targetRhythm = "Asystole"; s.sim.p.bloodVolume = 3.0; s.sim.p.blood = 3.0;
    s.sim.fatalVitals();
    s.sim.p.rhythm = "Asystole";
    s.act("aed_applypads", "body");
    s.act("aed_analyzerhythm", "body");
    s.tick(20);
    assert.ok(s.sim.events.some((e) => e.event === "aedSound" && e.name === "aed_noshockadvised"));

    s = session({ ACM_AED: 1 });
    s.sim.p.targetRhythm = "VF"; s.sim.fatalVitals();
    s.act("aed_applypads", "body");
    s.act("cpr", "body");
    s.act("aed_analyzerhythm", "body");
    s.tick(20);
    assert.equal(aedState(s.sim.p).message, "MOTION DETECTED");
});

test("a patient treated while unconscious stays lying after waking", () => {
    const s = session({});
    s.sim.criticalVitals();
    s.act("checkairway", "head");
    assert.equal(s.sim.p.wasTreated, true);
    s.sim.wakeUp();
    assert.equal(s.sim.p.lying, true);
});

test("CM-4 hemothorax: seal, TXA, thoracostomy, tube and drain pass the rubric", () => {
    const s = scenario("cm4-hemothorax");
    s.act("applychestseal", "body");
    s.act("insertio_fast1", "body");
    s.draw(10, "TXA", 10);
    s.act("txa_10_iv", "body");
    s.addBag("body", 0, false, "ACM_BloodBag_ON_500");
    s.tick(30);
    s.act("performthoracostomy_kit", "body");
    s.act("insertchesttube", "body");
    s.act("drainfluid_accuvac", "body");
    s.act("checkairway", "head");
    s.until(720);
    const r = s.score();
    assert.equal(r.passed, true, failed(r).join(", "));
});

test("CM-5 arrest: CPR, pads, shock, IO epinephrine passes the rubric", () => {
    const s = scenario("cm5-cardiac-arrest");
    s.act("cpr", "body");
    s.act("aed_applypads", "body");
    s.sim.act("cprStop");
    s.act("aed_analyzerhythm", "body");
    for (let k = 0; k < 25 && !aedState(s.sim.p).charged; k++) s.tick(1);
    assert.ok(!s.act("aed_shock", "body").error);
    s.act("cpr", "body");
    s.act("insertio_fast1", "body");
    s.draw(10, "Epinephrine", 1);
    s.act("epinephrine_10_iv", "body");
    for (let k = 0; k < 40 && s.sim.p.cardiacArrest; k++) s.tick(5);
    s.sim.act("cprStop");
    s.act("insertigel", "head");
    s.until(900);
    const r = s.score();
    assert.equal(r.passed, true, failed(r).join(", "));
});
