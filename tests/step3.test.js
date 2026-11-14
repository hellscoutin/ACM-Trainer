// Circulation (IV/IO, bags, pressure cuff, hemolytic reaction), thoracostomy family, stitching/wrapping, CM scenarios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Simulation } from "../engine/sim.js";
import { insertIV, removeIV, insertIO, addBag, removeBag, returnVolume, bagInfo, bagItemClass, cuffSignal, attachCuff, canInsertIV, inspectIV } from "../engine/circulation.js";
import { thoracostomy, insertChestTube, drainChest, closeIncision, applyChestSeal } from "../engine/breathing.js";
import { buildCatalogue, available, actionTime } from "../engine/menu.js";
import { loadScenario } from "../engine/scenario.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = read("../data/acm-1.4.8.json");
const meds = read("../data/medications-1.4.8.json");
const sim = (seed = 1, o = {}) => new Simulation({ data, meds, seed, ...o });
const catalogue = buildCatalogue(data);
const action = (id) => catalogue.find((a) => a.id === id);

test("IV succeeds on a healthy arm and fails when systolic is below 70 (arm)", () => {
    const s = sim(1);
    s.run(5);
    assert.equal(insertIV(s, "leftarm", 0, "IV_16g", 1).ok, true);
    const t = sim(2);
    t.run(5);
    t.p.bp = [40, 65];
    for (let k = 0; k < 3; k++) assert.equal(insertIV(t, "rightarm", k, "IV_16g", 1).ok, false);
});

test("IO always succeeds and hurts (0.31 pain without lidocaine)", () => {
    const s = sim(3);
    s.p.bp = [30, 50];
    assert.equal(insertIO(s, "leftleg", "IO_EZ").ok, true);
    assert.ok(Math.abs(s.p.pain - 0.31) < 1e-9);
});

test("pressure cuff blocks the upper IV site; an upper IV blocks the cuff", () => {
    const s = sim(4);
    attachCuff(s, "leftarm");
    assert.equal(canInsertIV(s.p, "leftarm", 0), false);
    assert.equal(canInsertIV(s.p, "leftarm", 1), true);
    const t = sim(5);
    t.run(5);
    insertIV(t, "rightarm", 0, "IV_16g", 1);
    assert.equal(attachCuff(t, "rightarm").ok, false);
});

test("saline via 16g runs ~5 ml/s; two bags of the same type on one site both run at full rate (ACM)", () => {
    const s = sim(6);
    s.run(5);
    insertIV(s, "leftarm", 1, "IV_16g", 1);
    s.p.blood = 5; s.p.bloodVolume = 5;
    addBag(s, "leftarm", 1, true, "ACE_salineIV");
    addBag(s, "leftarm", 1, true, "ACE_salineIV_500");
    s.run(20);
    const [a, b] = s.p.ivBags;
    assert.ok(Math.abs((1000 - a.remaining) - 20 * 4.1667 * 1.2) < 1);
    assert.ok(Math.abs((500 - b.remaining) - 20 * 4.1667 * 1.2) < 1);
});

test("different fluid types on one site share the flow", () => {
    const s = sim(7);
    s.run(5);
    insertIV(s, "leftarm", 1, "IV_16g", 1);
    s.p.blood = 5; s.p.bloodVolume = 5;
    addBag(s, "leftarm", 1, true, "ACE_salineIV");
    addBag(s, "leftarm", 1, true, "ACM_BloodBag_ON_500");
    s.run(20);
    const saline = s.p.ivBags.find((b) => b.type === "Saline");
    assert.ok(Math.abs((1000 - saline.remaining) - (20 * 4.1667 * 1.2) / 2) < 1);
});

test("removing a bag or the IV returns it rounded down to 1000/500/250 ml", () => {
    assert.deepEqual([returnVolume(999), returnVolume(500), returnVolume(260), returnVolume(249)], [500, 500, 250, 0]);
    const s = sim(8);
    s.run(5);
    insertIV(s, "leftarm", 2, "IV_16g", 1);
    addBag(s, "leftarm", 2, true, "ACE_salineIV");
    s.run(30);
    assert.deepEqual(removeBag(s, 0).returned, ["ACE_salineIV_500"]);
    addBag(s, "leftarm", 2, true, "ACM_BloodBag_A_250");
    assert.deepEqual(removeIV(s, "leftarm", 2).returned, ["ACM_BloodBag_A_250"]);
    assert.equal(s.p.ivAccess[2][2], null);
});

test("bag item classes round-trip; ACE blood bags count as O-", () => {
    assert.deepEqual(bagInfo("ACE_bloodIV_500"), { type: "Blood", volume: 500, bloodType: "O-" });
    assert.deepEqual(bagInfo("ACM_BloodBag_ABN_250"), { type: "Blood", volume: 250, bloodType: "AB-" });
    assert.equal(bagItemClass("Saline", 250, null), "ACE_salineIV_250");
    assert.equal(bagItemClass("Blood", 1000, "B+"), "ACM_BloodBag_B_1000");
});

test("incompatible blood starts a hemolytic reaction 30-60 s later", () => {
    const s = sim(9, { patient: { bloodType: "A-" } });
    s.run(5);
    insertIV(s, "leftarm", 1, "IV_16g", 1);
    addBag(s, "leftarm", 1, true, "ACM_BloodBag_B_500");
    s.run(25);
    assert.equal(s.p.reactionSeverity, 0);
    s.run(90);
    assert.ok(s.events.some((e) => e.event === "hemolyticReaction"));
    assert.ok(s.p.reactionSeverity >= 1);
});

test("inspect IV reports flow; the cuff hears nothing under 80 systolic or under a tourniquet", () => {
    const s = sim(10);
    s.run(5);
    insertIV(s, "leftarm", 1, "IV_16g", 1);
    assert.equal(inspectIV(s, "leftarm", 1).hint[0], "IV Catheter is clear");
    addBag(s, "leftarm", 1, true, "ACE_salineIV");
    assert.equal(inspectIV(s, "leftarm", 1).hint[0], "IV Catheter has normal flow");
    assert.ok(cuffSignal(s, "rightarm").hr > 0);
    s.act("tourniquet", { part: "rightarm" });
    assert.equal(cuffSignal(s, "rightarm").hr, 0);
    s.p.bp = [50, 75];
    assert.equal(cuffSignal(s, "leftarm").hr, 0);
});

test("thoracostomy opens the chest (PTX 3, tension gone), knocks out without lidocaine; tube, drain, close", () => {
    const s = sim(11);
    s.p.chestInjury = true; s.p.ptx = 4; s.p.tensionPtx = true; s.p.htxFluid = 0.5; s.p.tensionTime = 0;
    const r = thoracostomy(s, true);
    assert.ok(r.hint.includes("Lung is severely collapsed"));
    assert.equal(s.p.tensionPtx, false);
    assert.equal(s.p.ptx, 3);
    assert.equal(s.p.unconscious, true);
    insertChestTube(s);
    assert.equal(s.p.ptx, 0);
    assert.match(drainChest(s, 1).hint[1], /~500 ml/);
    assert.equal(s.p.htxFluid, 0);
    closeIncision(s);
    assert.equal(s.p.thoracostomy, 0);
});

test("a chest tube unseals 60-120 s after the patient is awake and up", () => {
    const s = sim(12);
    s.p.chestInjury = true;
    thoracostomy(s, true);
    insertChestTube(s);
    s.p.unconscious = false; s.p.lying = false;
    s.run(130);
    assert.equal(s.p.thoracostomy, 3);
    assert.equal(s.p.ptx, 3);
});

test("menu: IV needs a medic; transfusion menu needs access; times from settings", () => {
    const s = sim(13);
    const ctx = { sim: s, level: 0, inventory: { ACM_IV_16g: 1, ACM_IO_EZ: 1 }, name: "You" };
    assert.match(available(ctx, action("insertiv_16_middle"), "leftarm"), /Medics/);
    ctx.level = 1;
    assert.equal(available(ctx, action("insertiv_16_middle"), "leftarm"), null);
    assert.equal(actionTime(ctx, action("insertiv_16_middle"), "leftarm"), 6);
    assert.equal(actionTime(ctx, action("insertio_ez"), "leftleg"), 4);
    assert.match(available(ctx, action("opentransfusionmenu"), "leftarm"), /Condition/);
    s.run(5);
    insertIV(s, "leftarm", 1, "IV_16g", 1);
    assert.equal(available(ctx, action("opentransfusionmenu"), "leftarm"), null);
    assert.match(available(ctx, action("surgicalkit"), "leftarm"), /Requires/);
});

test("stitching and wrapping need non-bleeding bandaged wounds", () => {
    const s = sim(14);
    s.act("wound", { part: "rightleg", type: "Cut", damage: 0.4 });
    const ctx = { sim: s, level: 1, inventory: { ACE_surgicalKit: 1, ACM_ElasticWrap: 1 }, name: "You" };
    assert.match(available(ctx, action("surgicalkit"), "rightleg"), /Condition/);
    s.act("bandage", { part: "rightleg", bandage: "pressurebandage" });
    assert.equal(available(ctx, action("surgicalkit"), "rightleg"), null);
    assert.equal(actionTime(ctx, action("surgicalkit"), "rightleg"), 5);
    assert.equal(available(ctx, action("elasticwrapbandages"), "rightleg"), null);
});

test("Combat Medic scenarios: fatal untreated, survivable with correct care", () => {
    const load = (id) => loadScenario(read(`../scenarios/${id}.json`), data, meds);
    let s = load("cm1-hemorrhagic-shock");
    s.run(600);
    assert.equal(s.p.alive, false);
    s = load("cm1-hemorrhagic-shock");
    s.run(10); s.act("tourniquet", { part: "leftleg" }); s.run(10);
    assert.equal(insertIV(s, "rightarm", 1, "IV_16g", 1).ok, true);
    addBag(s, "rightarm", 1, true, "ACM_BloodBag_ON_500"); addBag(s, "rightarm", 1, true, "ACM_BloodBag_ON_500"); addBag(s, "rightarm", 1, true, "ACE_salineIV");
    s.run(580);
    assert.ok(s.p.alive && s.p.bloodVolume > 5.1, `bv ${s.p.bloodVolume}`);

    s = load("cm2-tension-chest");
    s.run(600);
    assert.equal(s.p.alive && s.p.spo2 > 80, false);
    s = load("cm2-tension-chest");
    s.run(20); applyChestSeal(s); s.run(580);
    assert.ok(s.p.alive && s.p.spo2 > 90, `spo2 ${s.p.spo2}`);
});
