// Step 7: damage types, fractures, training computer, new mechanism scenarios, editor validation, replay frames, CSV.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Simulation } from "../engine/sim.js";
import { interpolate, applyDamage, generatePatient, DAMAGE_TYPES } from "../engine/damage.js";
import { createSession } from "../engine/runner.js";
import { buildCatalogue } from "../engine/menu.js";
import { randomScenario, GENERIC_RUBRIC, knownItems, validateScenario, captureFrame, pushFrame, frameAt, recordsToCSV, makeRecord } from "../engine/custom.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = read("../data/acm-1.4.8.json");
const meds = read("../data/medications-1.4.8.json");
const mk = (seed = 1) => new Simulation({ data, meds, seed });
const session = (id, seed) => { const scn = read(`../scenarios/${id}.json`); return [createSession(scn, data, meds, { seed, rubric: read(`../${scn.rubric}`) }), scn]; };
const PARTS = ["head", "body", "leftarm", "rightarm", "leftleg", "rightleg"];
const failedIds = (res) => res.results.filter((r) => r.status === "fail").map((r) => r.check.id);
function bandageAll(s, kinds = ["emergencytraumadressing", "pressurebandage"]) {
    for (let pass = 0; pass < 12; pass++) for (const part of PARTS) {
        if (!(s.sim.p.openWounds[part] || []).some((w) => w.count > 0 && w.bleeding > 0)) continue;
        for (const k of kinds) if (!s.act(k, part).error) break;
    }
}

test("interpolatePoints: clamps at the ends, interpolates between points", () => {
    const pts = DAMAGE_TYPES.grenade.thresholds;
    assert.equal(interpolate(25, pts), 10);
    assert.equal(interpolate(0, pts), 0);
    assert.equal(interpolate(7, pts), 4); // halfway between [10,5] and [4,3]
});

test("applyDamage: more damage makes more wounds; vehicle crash picks a random part", () => {
    const count = (type, dmg) => { const s = mk(3); return applyDamage(s, "leftleg", type, dmg).length; };
    assert.ok(count("grenade", 12) > count("grenade", 1));
    assert.equal(count("grenade", 0.1), 0);
    const s = mk(4);
    const parts = new Set();
    for (let i = 0; i < 30; i++) for (const w of applyDamage(s, "body", "vehiclecrash", 1.4)) parts.add(w.part);
    assert.ok(parts.size > 2);
});

test("heavy limb damage fractures the limb; inspect, realign and splint set the bone", () => {
    const [s] = session("cm7-ied-blast");
    assert.equal(s.sim.p.fractures[4], 1);
    assert.ok(s.act("inspectforfracture", "leftleg").hint?.length, "inspection gives a finding");
    assert.ok(!s.act("fracturerealignment", "leftleg").error);
    assert.ok(!s.act("applysamsplint", "leftleg").error);
    assert.equal(s.sim.p.fractures[4], -1);
});

test("training computer: AI casualty, immune to instant death, severity scales the wounds", () => {
    const wounds = (sev) => { let n = 0; for (let seed = 1; seed <= 10; seed++) { const s = mk(seed); generatePatient(s, sev, 0); n += Object.values(s.p.openWounds).flat().reduce((a, w) => a + w.count, 0); assert.ok(s.p.ai && s.p.instantDeathImmune); } return n; };
    assert.ok(wounds(4) > wounds(1));
    const scn = randomScenario({ severity: 3, cause: 3, role: "medic", seed: 9 });
    assert.equal(scn.random.cause, 3);
    assert.equal(randomScenario({ severity: 3, cause: 5 }).random.cause, 0, "falls are not offered for Immediate");
    const [a, b] = [createSession(scn, data, meds), createSession(scn, data, meds)];
    assert.deepEqual(a.sim.p.openWounds, b.sim.p.openWounds, "same seed, same patient");
});

test("random patients die untreated; the generic rubric scores them", () => {
    const s = createSession(randomScenario({ severity: 2, seed: 7 }), data, meds, { rubric: GENERIC_RUBRIC });
    s.until(900);
    assert.equal(s.sim.p.alive, false);
    const r = s.score();
    assert.equal(r.passed, false);
    assert.ok(r.criticalFails.some((x) => x.check.id === "alive"));
});

test("CLS-5 grenade fragments: fatal untreated; bandage, seal, splint, paracetamol passes", () => {
    let [s, scn] = session("cls5-grenade-fragments");
    s.until(scn.timeLimit);
    assert.equal(s.sim.p.alive, false);
    [s, scn] = session("cls5-grenade-fragments");
    s.tick(3);
    bandageAll(s, ["pressurebandage"]);
    assert.ok(!s.act("applychestseal", "body").error);
    assert.ok(!s.act("applysamsplint", "leftarm").error);
    assert.ok(!s.act("paracetamol", "head").error);
    s.until(scn.timeLimit);
    const r = s.score();
    assert.equal(r.passed, true, failedIds(r).join(", "));
});

test("CM-7 IED blast: fatal in under 4 minutes untreated; tourniquet, dressings, TXA, blood, splint passes", () => {
    let [s, scn] = session("cm7-ied-blast");
    s.until(scn.timeLimit);
    assert.equal(s.sim.p.alive, false);
    assert.ok(s.sim.p.t < 240);
    [s, scn] = session("cm7-ied-blast");
    s.tick(3);
    assert.ok(!s.act("applytourniquet", "rightleg").error);
    bandageAll(s);
    assert.ok(!s.act("applychestseal", "body").error);
    assert.ok(!s.act("insertiv_16_middle", "rightarm").error);
    assert.ok(s.draw(10, "TXA", 10).ok);
    assert.ok(!s.act("txa_10_iv", "rightarm").error);
    s.addBag("rightarm", 1, true, "ACM_BloodBag_ON_500");
    s.addBag("rightarm", 1, true, "ACM_BloodBag_ON_500");
    s.act("inspectforfracture", "leftleg"); s.act("fracturerealignment", "leftleg"); s.act("applysamsplint", "leftleg");
    s.until(scn.timeLimit);
    const r = s.score();
    assert.equal(r.passed, true, failedIds(r).join(", "));
});

test("CM-8 helicopter crash: fatal untreated; full treatment incl. both splints passes", () => {
    let [s, scn] = session("cm8-helicopter-crash");
    assert.ok(s.sim.p.ptx >= 1 && s.sim.p.internalBleeding > 0);
    s.until(scn.timeLimit);
    assert.equal(s.sim.p.alive, false);
    [s, scn] = session("cm8-helicopter-crash");
    s.tick(3);
    bandageAll(s);
    assert.ok(!s.act("checkbreathing", "head").error);
    assert.ok(!s.act("insertiv_16_middle", "rightarm").error);
    s.draw(10, "TXA", 10); s.act("txa_10_iv", "rightarm");
    s.addBag("rightarm", 1, true, "ACM_BloodBag_ON_500"); s.addBag("rightarm", 1, true, "ACM_BloodBag_ON_500");
    assert.ok(!s.act("applychestseal", "body").error);
    for (const leg of ["leftleg", "rightleg"]) { s.act("inspectforfracture", leg); s.act("fracturerealignment", leg); s.act("applysamsplint", leg); }
    s.until(scn.timeLimit);
    const r = s.score();
    assert.equal(r.passed, true, failedIds(r).join(", "));
});

test("editor validation: all built-in scenarios and role kits pass; bad input is reported", () => {
    const items = knownItems(data, buildCatalogue(data));
    for (const id of read("../scenarios/index.json").scenarios) {
        const v = validateScenario(read(`../scenarios/${id}.json`), data, items);
        assert.ok(v.ok, `${id}: ${v.errors.join("; ")}`);
    }
    for (const role of ["anyone", "medic", "doctor"]) assert.ok(validateScenario(randomScenario({ role }), data, items).ok);
    const bad = validateScenario({ title: "", role: "pilot", timeLimit: 5, injuries: [{ part: "tail", mechanism: "laser", damage: 99 }], loadout: { Nope: 1 } }, data, items);
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.length >= 6, bad.errors.join("; "));
});

test("replay frames: deltas rebuild the full frame at any second", () => {
    const s = createSession(randomScenario({ severity: 2, cause: 1, seed: 5 }), data, meds);
    const frames = [], full = [];
    for (let i = 0; i < 60; i++) { s.tick(1); const f = captureFrame(s.sim); full.push(f); pushFrame(frames, f); }
    assert.ok(frames.filter((f) => f.inj).length < frames.length);
    for (const k of [0, 17, 59]) assert.deepEqual(frameAt(frames, full[k].t), full[k]);
});

test("records CSV: header, quoting and formula-safe cells", () => {
    const s = createSession(randomScenario({ severity: 1, seed: 2 }), data, meds, { rubric: GENERIC_RUBRIC });
    s.tick(30);
    const rec = makeRecord(s.sim.scenario, 2, s.sim, s.score(), new Date("2026-01-02T03:04:05Z"));
    const csv = recordsToCSV([rec, { ...rec, title: '=HYPERLINK("x"), y' }]);
    const lines = csv.trim().split("\r\n");
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^date,scenario,module,title/);
    assert.match(lines[1], /^2026-01-02T03:04:05.000Z,random,Random,/);
    assert.match(lines[2], /"'=HYPERLINK\(""x""\), y"/);
});
