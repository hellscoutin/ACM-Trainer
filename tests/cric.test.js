// Surgical airway: procedure state machine, failure, cancel, incision bleeding, menu conditions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Simulation } from "../engine/sim.js";
import { ZONES, palpate, startProcedure, beginIncision, finishIncision, action, endProcedure, incisionBleedRate, canEstablish } from "../engine/surgicalAirway.js";
import { airwayState } from "../engine/oxygen.js";
import { buildCatalogue, available } from "../engine/menu.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = read("../data/acm-1.4.8.json");
const meds = read("../data/medications-1.4.8.json");
const down = (seed = 1) => { const s = new Simulation({ data, meds, seed }); s.criticalVitals(); return s; };
const V = ZONES.incisionVertical, Hz = ZONES.incisionHorizontal;
const verticalCut = [V[0] + 0.15, V[1] - 0.6, 0.1, V[3] + 1.2]; // starts above, ends below the site
const horizontalCut = [Hz[0] - 0.4, Hz[1] + 0.3, Hz[2] + 0.8, 0.1];

function establish(s) {
    startProcedure(s);
    beginIncision(s); finishIncision(s, verticalCut, true, verticalCut[3]);
    beginIncision(s); finishIncision(s, horizontalCut, false, 0);
    action(s, 1); action(s, 2); action(s, 3); action(s, 4); action(s, 5);
}

test("palpation colours: membrane before the cut, opening after", () => {
    const s = down();
    const sa = startProcedure(s);
    const membrane = [ZONES.entryArea[0] + 0.2, ZONES.entryArea[1] + 0.5];
    assert.equal(palpate(sa, membrane), "rgba(255,26,179,0.7)");
    sa.verticalSuccess = true;
    assert.equal(palpate(sa, [ZONES.entry[0] + 1, ZONES.entry[1] + 0.3]), "rgba(0,255,255,0.7)");
});

test("full procedure: incisions, hook, Cric-Key, cuff and stylet establish the airway (airway state 1)", () => {
    const s = down();
    establish(s);
    assert.equal(s.p.surgicalAirway, true);
    assert.equal(s.p.sa.incisionCount, 2);
    s.p.airwayCollapse = 3; s.p.obstructionVomit = 2;
    assert.equal(airwayState(s.p), 1);
    assert.equal(action(s, 6), "Connected neck strap");
    assert.equal(action(s, 7), "Secured neck strap");
    assert.deepEqual(endProcedure(s), { established: true });
});

test("steps must follow the order: the tube cannot go in before the hook lifts the incision", () => {
    const s = down();
    startProcedure(s);
    beginIncision(s); finishIncision(s, verticalCut, true, verticalCut[3]);
    beginIncision(s); finishIncision(s, horizontalCut, false, 0);
    action(s, 2);
    assert.equal(s.p.sa.tube, false);
    action(s, 1);
    assert.equal(s.p.sa.hook, true);
});

test("a cut outside the landmark fails the procedure and leaves head wounds", () => {
    const s = down();
    startProcedure(s);
    beginIncision(s);
    const r = finishIncision(s, [11, 15, 0.1, 1], true, 1);
    assert.equal(r.failed, true);
    assert.deepEqual(endProcedure(s), { failed: true });
    assert.ok(s.p.openWounds.head.some((w) => w.type === "Cut"));
});

test("cancelling before cutting returns the kit; after cutting, incisions become wounds", () => {
    let s = down();
    startProcedure(s);
    assert.deepEqual(endProcedure(s), { kitReturned: true });
    s = down();
    startProcedure(s);
    beginIncision(s); finishIncision(s, verticalCut, true, verticalCut[3]);
    assert.deepEqual(endProcedure(s), { cancelled: true });
    assert.ok(s.p.openWounds.head.length > 0);
});

test("incisions bleed (count x 0.02 x severity x cardiac output) until stitched", () => {
    const s = down();
    s.run(5);
    establish(s);
    endProcedure(s);
    const rate = incisionBleedRate(s);
    assert.ok(rate > 0);
    const bv = s.p.bloodVolume;
    s.run(60);
    assert.ok(s.p.bloodVolume < bv);
    s.p.incisionStitched = true;
    assert.equal(incisionBleedRate(s), 0);
});

test("menu: surgical airway needs a medic, the kit and an unconscious patient; a patient with one cannot wake", () => {
    const cat = buildCatalogue(data);
    const a = cat.find((x) => x.id === "establishsurgicalairway");
    const s = new Simulation({ data, meds, seed: 2 });
    const ctx = { sim: s, level: 1, inventory: { ACM_CricKit: 1 }, name: "You" };
    assert.match(available(ctx, a, "head"), /Condition/);
    s.criticalVitals();
    assert.equal(available(ctx, a, "head"), null);
    ctx.level = 0;
    assert.match(available(ctx, a, "head"), /Medics/);
    assert.equal(canEstablish(s.p), true);
    establish(s);
    endProcedure(s);
    s.p.knockOut = false;
    s.run(200);
    assert.equal(s.p.unconscious, true);
});
