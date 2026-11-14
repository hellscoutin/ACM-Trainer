// Airway, breathing, examinations, menu catalogue and the Combat Lifesaver scenarios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Simulation } from "../engine/sim.js";
import { airwayState, breathingState } from "../engine/oxygen.js";
import { checkAirway, headTurn, suction, setRecoveryPosition, insertAirwayItem } from "../engine/airway.js";
import { applyChestSeal, performNCD, checkBreathing, inspectChest } from "../engine/breathing.js";
import { feelPulse, capillaryRefill, checkResponse } from "../engine/exams.js";
import { buildCatalogue, available, actionTime } from "../engine/menu.js";
import { injuryList } from "../engine/injuryList.js";
import { loadScenario } from "../engine/scenario.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = read("../data/acm-1.4.8.json");
const meds = read("../data/medications-1.4.8.json");
const sim = (seed = 1) => new Simulation({ data, meds, seed });
const catalogue = buildCatalogue(data);
const action = (id) => catalogue.find((a) => a.id === id);

test("airway reflex: lost 20-45 s after going down, restored if the knock-out timer ends later (ACM race)", () => {
    for (const seed of [3, 4, 5, 6, 7, 8]) {
        const s = sim(seed);
        s.criticalVitals();
        s.p.bloodVolume = 5.0; s.p.blood = 5.0; // can't wake (below 5.1 L), so the outcome is visible
        const lossAt = s.timers.find((t) => t.kind === "airwayReflexLoss").at;
        const koAt = s.timers.find((t) => t.kind === "knockOutEnds").at;
        assert.ok(lossAt >= 20 && lossAt <= 45 && koAt >= 15 && koAt <= 35);
        s.run(50);
        assert.equal(s.p.airwayReflex, koAt > lossAt, `seed ${seed}: loss ${lossAt}, knock-out end ${koAt}`);
        if (!s.p.airwayReflex) assert.ok(Math.abs(airwayState(s.p) - 0.78) < 1e-9);
    }
});

test("recovery position holds the airway at 0.97 and clears a light obstruction", () => {
    const s = sim(4);
    s.criticalVitals();
    s.p.obstructionVomit = 1;
    assert.equal(airwayState(s.p), 0);
    assert.equal(setRecoveryPosition(s, true).ok, true);
    assert.equal(s.p.obstructionVomit, 0);
    s.p.airwayCollapse = 3;
    assert.ok(Math.abs(airwayState(s.p) - 0.97) < 1e-9);
});

test("head turning clears level-1 obstruction only; suction clears everything", () => {
    const s = sim(5);
    s.criticalVitals();
    s.p.obstructionVomit = 2; s.p.obstructionBlood = 1;
    assert.deepEqual(headTurn(s).hint, ["Head turning performed", "Medical suction required"]);
    assert.equal(s.p.obstructionBlood, 0);
    assert.equal(s.p.obstructionVomit, 2);
    suction(s);
    assert.equal(s.p.obstructionVomit, 0);
    assert.deepEqual(checkAirway(s).hint, ["Airway is clear"]);
});

test("airway adjuncts fail on an awake or obstructed patient and don't fix collapse", () => {
    const s = sim(6);
    assert.equal(insertAirwayItem(s, "NPA").ok, false);
    s.criticalVitals();
    s.p.obstructionBlood = 1;
    assert.equal(insertAirwayItem(s, "NPA").ok, false);
    s.p.obstructionBlood = 0;
    assert.equal(insertAirwayItem(s, "NPA").ok, true);
    s.p.airwayCollapse = 3;
    assert.equal(airwayState(s.p), 0); // min(collapse 0, ...) : adjuncts don't hold a collapsed airway
});

test("waking resets the airway (adjuncts and positioning removed)", () => {
    const s = sim(7);
    s.criticalVitals();
    insertAirwayItem(s, "NPA");
    s.wakeUp();
    assert.equal(s.p.airwayNasal, "");
    assert.equal(s.p.airwayReflex, true);
});

test("chest seal resets pneumothorax and stops progression; NCD without tension makes it level 3", () => {
    const s = sim(8);
    s.p.chestInjury = true;
    s.p.ptx = 2;
    applyChestSeal(s);
    assert.equal(s.p.ptx, 0);
    const t = sim(9);
    t.p.chestInjury = true;
    t.p.ptx = 1;
    performNCD(t);
    assert.equal(t.p.ptx, 3);
});

test("NCD relieves tension pneumothorax", () => {
    const s = sim(10);
    s.p.chestInjury = true;
    s.p.ptx = 4; s.p.tensionPtx = true; s.p.tensionTime = 0;
    assert.equal(breathingState(s.p), 0.1);
    performNCD(s);
    assert.equal(s.p.tensionPtx, false);
});

test("check breathing and inspect chest report as in game", () => {
    const s = sim(11);
    s.run(5);
    assert.equal(checkBreathing(s).log, "Normal");
    s.p.ptx = 1;
    assert.match(checkBreathing(s).log, /hallow/);
    s.criticalVitals();
    s.p.obstructionVomit = 2;
    s.run(2);
    assert.equal(checkBreathing(s).log, "None");
    assert.match(inspectChest(s).log, /No chest movement, chest sides uneven/);
});

test("examinations: no radial pulse under a tourniquet, capillary refill ~2 s when healthy, response", () => {
    const s = sim(12);
    s.run(10);
    assert.ok(feelPulse(s, "leftarm").rate > 0);
    s.act("tourniquet", { part: "leftarm" });
    assert.equal(feelPulse(s, "leftarm").rate, 0);
    assert.ok(["~2", "<3"].some((v) => capillaryRefill(s, "body").hint[1].startsWith(v)));
    assert.equal(checkResponse(s).log, "Patient is responsive");
});

test("menu: actions are listed only when their item, level and condition allow", () => {
    const s = sim(13);
    const ctx = { sim: s, level: 0, inventory: { ACE_tourniquet: 1, ACM_NPA: 1, ACM_NCDKit: 1 }, name: "You", patientName: "Patient" };
    assert.equal(available(ctx, action("applytourniquet"), "leftleg"), null);
    assert.match(available(ctx, action("applytourniquet"), "head"), /body part/);
    assert.match(available(ctx, action("pressurebandage"), "leftleg"), /Requires/);
    ctx.inventory.ACM_PressureBandage = 1;
    assert.match(available(ctx, action("pressurebandage"), "leftleg"), /Condition/); // not bleeding
    assert.match(available(ctx, action("insertnpa"), "head"), /Condition/); // patient awake
    s.p.chestInjury = true;
    assert.match(available(ctx, action("performncd"), "body"), /Medics/);
    assert.equal(actionTime(ctx, action("applytourniquet"), "leftleg"), 7);
    assert.equal(actionTime(ctx, action("recoveryposition"), "body"), 8);
});

test("injury list uses the game's wording", () => {
    const s = sim(14);
    s.act("wound", { part: "leftleg", type: "VelocityWound", damage: 1.4 });
    s.run(30);
    const texts = injuryList(s, "leftleg").map((e) => e.text);
    assert.ok(texts.includes("1x Large Velocity Wound"));
    assert.ok(texts.some((t) => /bleeding$/.test(t)));
    s.act("tourniquet", { part: "leftleg" });
    assert.ok(injuryList(s, "leftleg").some((e) => e.text.startsWith("Tourniquet [CAT] [00:00]")));
});

for (const id of read("../scenarios/index.json").scenarios) {
    test(`scenario ${id}: loads, and is fatal or near-fatal if untreated`, () => {
        const scn = read(`../scenarios/${id}.json`);
        const s = loadScenario(scn, data, meds);
        assert.ok(Object.keys(scn.loadout).length > 0);
        s.run(scn.timeLimit);
        assert.ok(!s.p.alive || s.p.cardiacArrest || s.p.spo2 < 80, `${id} untreated ended alive and stable`);
    });
}

test("CLS scenarios survive the textbook treatment", () => {
    const load = (id) => loadScenario(read(`../scenarios/${id}.json`), data, meds);
    let s = load("cls1-leg-hemorrhage");
    s.run(15); s.act("tourniquet", { part: "leftleg" }); s.run(15); s.act("bandage", { part: "rightarm", bandage: "pressurebandage" }); s.run(270);
    assert.ok(s.p.alive && s.p.woundBleeding === 0 && s.p.bloodVolume > 5);

    s = load("cls2-unconscious-airway");
    s.run(40); s.act("bandage", { part: "leftarm", bandage: "pressurebandage" }); s.run(30); setRecoveryPosition(s, true); s.run(530);
    assert.ok(s.p.alive && s.p.spo2 > 90);

    s = load("cls3-chest-gunshot");
    s.run(20); applyChestSeal(s); s.run(10); s.act("bandage", { part: "rightleg", bandage: "pressurebandage" }); s.run(450);
    assert.ok(s.p.alive && s.p.spo2 > 90);
});
