// Fentanyl lozenge (ACM_circulation setLozenge / setLozengeLocal) and the supine position it needs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSession } from "../engine/runner.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = read("../data/acm-1.4.8.json");
const meds = read("../data/medications-1.4.8.json");
const make = (loadout = { ACM_Lozenge_Fentanyl: 2, ACM_OPA: 1 }) =>
    createSession({ id: "t", seed: 1, role: "medic", patient: { conscious: true }, injuries: [{ part: "leftleg", type: "Avulsion", damage: 0.6 }], loadout }, data, meds);

test("lozenge needs a lying casualty; supine position lays an awake one down", () => {
    const s = make();
    assert.ok(s.act("fentanyllozenge", "head").error, "not lying: not offered");
    assert.ok(!s.act("supineposition", "body").error);
    assert.equal(s.sim.p.lying, true);
    assert.ok(!s.act("fentanyllozenge", "head").error);
    assert.equal(s.sim.p.lozenge, "Fentanyl");
    assert.ok(s.sim.p.meds.some((m) => m.name === "Fentanyl_BUC"));
});

test("lozenge wears off after 180 s and keeps its full course", () => {
    const s = make();
    s.act("supineposition", "body"); s.act("fentanyllozenge", "head");
    const m = s.sim.p.meds.find((x) => x.name === "Fentanyl_BUC");
    const total = m.total;
    s.tick(185);
    assert.equal(s.sim.p.lozenge, "");
    assert.equal(m.total, total);
});

test("passing out takes the lozenge out early and freezes the dose at the effect reached", () => {
    const s = make();
    s.act("supineposition", "body"); s.act("fentanyllozenge", "head");
    s.tick(20);
    s.sim.criticalVitals();
    s.tick(2);
    assert.equal(s.sim.p.lozenge, "");
    const m = s.sim.p.meds.find((x) => x.name === "Fentanyl_BUC");
    assert.ok(m.conc < 1, "dose frozen below the full effect");
});
