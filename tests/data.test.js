// Sanity checks for data/acm-1.4.8.json (values cross-checked against the ACM 1.4.8 code).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(new URL("../data/acm-1.4.8.json", import.meta.url), "utf8"));

test("data file identifies its ACM version", () => {
    assert.equal(data.meta.acm, "1.4.8");
});

test("key thresholds match ACM's macros", () => {
    assert.equal(data.thresholds.bloodVolume.default, 6.0);
    assert.equal(data.thresholds.bloodVolume.class4, 3.6);
    assert.equal(data.thresholds.spo2.death, 55);
    assert.equal(data.thresholds.spo2.hypoxicArrest, 67);
    assert.equal(data.thresholds.chest.tensionHemothoraxFluid, 1.2);
});

test("every blood type can receive O-", () => {
    for (const t of data.blood.types) assert.ok(data.blood.compatible[t].includes("O-"), t);
});

test("core treatments are present with ACM's defaults", () => {
    const byClass = Object.fromEntries(data.treatments.map((t) => [t.class, t]));
    assert.equal(byClass.insertigel.trainingLevel.default, "medic");
    assert.equal(byClass.insertigel.time.default, 7);
    assert.equal(byClass.applychestseal.trainingLevel, "anyone");
    assert.equal(byClass.emergencytraumadressing.selfAllowed, false);
});

test("settings carry resolved names", () => {
    for (const s of data.settings) assert.ok(!/STRING\(/.test(s.name), s.variable);
});
