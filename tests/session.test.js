// Step 5: instructor injects, set values and the live snapshot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSession } from "../engine/runner.js";
import { applyInject, applySet, snapshot, alerts, INJECTS } from "../engine/session.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = read("../data/acm-1.4.8.json");
const meds = read("../data/medications-1.4.8.json");
const make = (id = "cls1-leg-hemorrhage") => createSession(read(`../scenarios/${id}.json`), data, meds);

test("injects change the patient", () => {
    let s = make();
    s.act("applytourniquet", "leftleg");
    assert.match(applyInject(s.sim, "tourniquetSlip", {}), /slipped/);
    assert.equal(s.sim.p.tourniquets[4], 0);
    const before = s.sim.p.woundBleeding;
    applyInject(s.sim, "wound", { part: "rightarm", mechanism: "bullet", damage: 1.5 });
    assert.ok(s.sim.p.woundBleeding > before);
    applyInject(s.sim, "tension");
    assert.ok(s.sim.p.tensionPtx);
    applyInject(s.sim, "arrest");
    assert.ok(s.sim.p.cardiacArrest);
    s = make("cls2-unconscious-airway");
    s.tick(2);
    applyInject(s.sim, "vomit");
    assert.ok(s.sim.p.obstructionVomit > 0);
    for (const k of Object.keys(INJECTS)) applyInject(make().sim, k, { part: "body" }); // none throws
});

test("set values are clamped like a Zeus module", () => {
    const s = make();
    applySet(s.sim, "blood", 9);
    assert.equal(s.sim.p.blood, 6);
    applySet(s.sim, "spo2", 70);
    assert.equal(s.sim.p.spo2, 70);
    assert.equal(applySet(s.sim, "hr", 10), null, "only listed fields");
});

test("snapshot is Firestore-safe (no nested arrays) and small", () => {
    const s = make();
    s.tick(30);
    const snap = snapshot(s.sim, { status: "running", actions: [{ t: 1, id: "applytourniquet", part: "leftleg" }] });
    const nested = (v) => Array.isArray(v) ? v.some((x) => Array.isArray(x) || nested(x)) : v && typeof v === "object" ? Object.values(v).some(nested) : false;
    assert.equal(nested(snap), false);
    assert.equal(typeof snap.frame, "string");
    assert.ok(JSON.stringify(snap).length < 20000);
    assert.ok(alerts(s.sim).includes("Heavy bleeding"));
});
