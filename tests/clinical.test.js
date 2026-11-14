// Full clinical state and problem analysis (debrief, replay, instructor full view).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSession } from "../engine/runner.js";
import { clinicalState, analyzeProblems } from "../engine/clinical.js";
import { snapshot } from "../engine/session.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = read("../data/acm-1.4.8.json");
const meds = read("../data/medications-1.4.8.json");
const make = (id) => createSession(read(`../scenarios/${id}.json`), data, meds);
const problems = (s) => analyzeProblems({ history: s.recorder.history, log: s.sim.menuLog, events: s.sim.events });

test("hidden problems are found: pneumothorax untreated is 'not treated', a seal makes it treated", () => {
    let s = make("cls3-chest-gunshot");
    s.tick(60);
    let ptx = problems(s).find((p) => p.id === "ptx");
    assert.ok(ptx && ptx.status === "not treated");
    s = make("cls3-chest-gunshot");
    s.tick(5);
    s.act("applychestseal", "body");
    s.tick(60);
    ptx = problems(s).find((p) => p.id === "ptx");
    assert.ok(ptx.status === "resolved" || ptx.status === "treated");
    assert.ok(ptx.treatments.some((t) => t.id === "applychestseal"));
});

test("bleeding per part credits only actions on that part; arrest is resolved by ROSC", () => {
    const s = make("cls1-leg-hemorrhage");
    s.tick(3);
    s.act("applytourniquet", "leftleg");
    s.tick(30);
    const leg = problems(s).find((p) => p.id === "bleed_leftleg");
    assert.equal(leg.status, "resolved");
    assert.deepEqual(leg.treatments.map((t) => t.id), ["applytourniquet"]);
    assert.ok(!problems(s).find((p) => p.id === "bleed_rightarm")?.treatments.length);
});

test("conditions that end with death are not counted as resolved", () => {
    const s = make("cm7-ied-blast");
    s.until(900);
    assert.equal(s.sim.p.alive, false);
    for (const p of problems(s).filter((x) => x.id === "hypoxia" || x.id === "bv")) assert.equal(p.end, null);
});

test("clinical state shows drugs with timing and current effects", () => {
    const s = make("cm4-hemothorax");
    s.act("insertiv_16_middle", "rightarm");
    s.draw(10, "TXA", 10);
    s.act("txa_10_iv", "rightarm");
    s.tick(30);
    const c = clinicalState(s.sim);
    const txa = c.meds.find((m) => m.name === "TXA_IV");
    assert.ok(txa && txa.route === "IV" && txa.since >= 30 && txa.remaining > 0);
    assert.ok(c.breathing.ptx > 0 || c.breathing.htxFluid > 0);
});

test("snapshot with problems and clinical state stays Firestore-safe", () => {
    const s = make("cm2-tension-chest");
    s.tick(60);
    const snap = snapshot(s.sim, { status: "running", recorder: s.recorder });
    const nested = (v) => (Array.isArray(v) ? v.some((x) => Array.isArray(x) || nested(x)) : v && typeof v === "object" ? Object.values(v).some(nested) : false);
    assert.equal(nested(snap), false);
    assert.ok(snap.problems.length > 0 && snap.clinical.breathing);
    assert.ok(JSON.stringify(snap).length < 60000);
});
