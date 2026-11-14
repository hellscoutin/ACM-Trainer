// Engine fidelity tests: expected behaviour comes from ACM 1.4.8 code (see ACM Guide notes and engine comments).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Simulation } from "../engine/sim.js";
import { medicationEffect, ROUTE } from "../engine/pharmacology.js";
import { breathingState, airwayState } from "../engine/oxygen.js";

const data = JSON.parse(readFileSync(new URL("../data/acm-1.4.8.json", import.meta.url)));
const meds = JSON.parse(readFileSync(new URL("../data/medications-1.4.8.json", import.meta.url)));
const sim = (seed = 1, o = {}) => new Simulation({ data, meds, seed, ...o });

test("same seed and actions give identical results", () => {
    const run = () => {
        const s = sim(42);
        s.act("wound", { part: "rightarm", type: "VelocityWound", damage: 1, count: 2 });
        s.run(30);
        s.act("tourniquet", { part: "rightarm" });
        s.run(120);
        return s.snapshot();
    };
    assert.deepEqual(run(), run());
});

test("healthy patient stays stable for 10 minutes", () => {
    const s = sim(5);
    s.run(600);
    const p = s.p;
    assert.ok(p.alive && !p.unconscious && !p.cardiacArrest);
    assert.ok(Math.abs(p.bloodVolume - 6) < 1e-9);
    assert.ok(p.spo2 > 97 && p.hr > 60 && p.hr < 90, `spo2 ${p.spo2} hr ${p.hr}`);
});

test("no airway: SpO2 falls ~0.1-0.12 %/s, hypoxic arrest, death from oxygen deprivation in 6-8 min", () => {
    const s = sim(3);
    s.act("setState", { fields: { unconscious: true, obstructionVomit: 2 } });
    assert.equal(airwayState(s.p), 0);
    const start = s.p.spo2;
    s.run(60);
    const rate = (start - s.p.spo2) / 60;
    assert.ok(rate > 0.09 && rate < 0.13, `rate ${rate}`);
    s.run(600);
    assert.equal(s.p.alive, false);
    assert.equal(s.p.causeOfDeath, "Oxygen Deprivation");
    const death = s.events.find((e) => e.event === "death").t;
    assert.ok(death > 360 && death < 480, `death at ${death}`);
    assert.ok(s.events.some((e) => e.event === "cardiacArrest"));
});

test("bleeding lowers blood volume, raises heart rate and uses up platelets", () => {
    const s = sim(7);
    s.act("wound", { part: "leftleg", type: "VelocityWound", damage: 1.5, count: 2 });
    const hr0 = s.p.hr;
    s.run(60);
    assert.ok(s.p.bloodVolume < 5.5, `bv ${s.p.bloodVolume}`);
    assert.ok(s.p.hr > hr0 + 10, `hr ${s.p.hr}`);
    assert.ok(s.p.platelets < 2.5, `platelets ${s.p.platelets}`);
});

test("tourniquet stops limb bleeding; blood volume then holds", () => {
    const s = sim(7);
    s.act("wound", { part: "leftleg", type: "VelocityWound", damage: 1.5, count: 2 });
    s.run(10);
    s.act("tourniquet", { part: "leftleg" });
    assert.equal(s.p.woundBleeding, 0);
    const bv = s.p.bloodVolume;
    s.run(60);
    assert.ok(s.p.bloodVolume >= bv - 1e-6);
});

test("pressure bandage closes wounds and stops bleeding", () => {
    const s = sim(9);
    s.act("wound", { part: "rightarm", type: "Cut", damage: 0.5, count: 1 });
    assert.ok(s.p.woundBleeding > 0);
    const closed = s.act("bandage", { part: "rightarm", bandage: "PressureBandage" });
    assert.ok(closed > 0);
    assert.equal(s.p.woundBleeding, 0);
});

test("tension pneumothorax sets breathing state 0.1; PTX levels subtract 0.1 each", () => {
    const s = sim(1);
    s.p.ptx = 2;
    assert.ok(Math.abs(breathingState(s.p) - 0.8) < 1e-9);
    s.p.tensionPtx = true;
    assert.equal(breathingState(s.p), 0.1);
});

test("medication curves: IV sine rise, plateau 1, cosine decline; IM exponential rise", () => {
    // Epinephrine IV: onset 5, plateau 180, total 300
    assert.ok(medicationEffect(ROUTE.IV, 5, 5, 300, 180) > 0.99);
    assert.equal(medicationEffect(ROUTE.IV, 100, 5, 300, 180), 1);
    assert.ok(medicationEffect(ROUTE.IV, 299, 5, 300, 180) < 0.01);
    assert.ok(Math.abs(medicationEffect(ROUTE.IM, 20, 30, 360, 240) - 1.1 ** -10) < 1e-9);
});

test("IV epinephrine raises heart rate; morphine suppresses pain", () => {
    const s = sim(11);
    s.run(30);
    const hr0 = s.p.hr;
    s.act("insertIV", { part: "leftarm" });
    s.act("medication", { part: "leftarm", name: "Epinephrine_IV", dose: 1, iv: true });
    s.run(60);
    assert.ok(s.p.hr > hr0 + 8, `hr ${hr0} -> ${s.p.hr}`);

    const t = sim(12);
    t.act("wound", { part: "leftleg", type: "Contusion", damage: 1.5 });
    assert.ok(t.p.pain > 0.2);
    // 5 mg IM is below the weight-scaled minimum dose, so onset stretches to ~170 s (100 s / concentration ratio)
    t.act("medication", { part: "rightarm", name: "Morphine", dose: 5 });
    t.run(150);
    assert.ok(t.p.painSuppress < 0.2, `early suppress ${t.p.painSuppress}`);
    t.run(150);
    assert.ok(t.p.painSuppress > 0.35, `suppress ${t.p.painSuppress}`);
});

test("medication into a limb with a tourniquet is held until the tourniquet comes off", () => {
    const s = sim(2);
    s.act("tourniquet", { part: "leftarm" });
    const r = s.act("medication", { part: "leftarm", name: "Morphine", dose: 5 });
    assert.equal(r.occluded, true);
    assert.equal(s.p.meds.length, 0);
    s.act("removeTourniquet", { part: "leftarm" });
    assert.equal(s.p.meds.length, 1);
});

test("saline through a 16g IV restores volume at ~5 ml/s", () => {
    const s = sim(4);
    s.act("setState", { fields: { blood: 4.8 } });
    s.act("insertIV", { part: "leftarm" });
    s.act("addBag", { part: "leftarm", type: "Saline", volume: 1000 });
    s.run(100);
    const bag = s.p.ivBags[0];
    assert.ok(Math.abs(1000 - bag.remaining - 100 * 4.1667 * 1.2) < 5, `infused ${1000 - bag.remaining}`);
    assert.ok(s.p.bloodVolume > 5.2, `bv ${s.p.bloodVolume}`);
});

test("incompatible blood goes to saline, drops platelets and builds reaction volume", () => {
    const s = sim(4, { patient: { bloodType: "A-" } });
    s.act("setState", { fields: { blood: 5 } });
    s.act("insertIV", { part: "leftarm" });
    s.act("addBag", { part: "leftarm", type: "Blood", volume: 500, bloodType: "B+" });
    s.run(30);
    assert.ok(s.p.saline > 0 && s.p.reactionVolume > 0);
    assert.equal(s.p.transfused, 0);
});

function arrest(seed, rhythm = "VF") {
    const s = sim(seed);
    s.p.unconscious = true;
    s.p.cardiacArrest = true;
    s.p.hr = 0;
    s.p.rhythm = rhythm;
    s.p.arrestLoop = true;
    s.p.cprStoppedTime = 0;
    return s;
}

test("CPR: no success chance before ~59 s of continuous compressions", () => {
    const s = arrest(21);
    s.act("cprStart", { skill: 1 });
    for (let i = 0; i < 55; i++) {
        s.tick();
        if (s.p.t % 5 === 0 && s.p.t > 5) assert.equal(s.p.lastCprChance, 0, `t=${s.p.t}`);
    }
    assert.equal(s.p.cardiacArrest, true);
});

test("CPR chance matches the guide formula (medic, VF, full blood volume, first session)", () => {
    const s = arrest(22);
    s.act("cprStart", { skill: 1 });
    let seen = null;
    for (let i = 0; i < 125 && s.p.cardiacArrest; i++) {
        s.tick();
        if (s.p.t === 120) seen = s.p.lastCprChance;
    }
    assert.notEqual(seen, null, "ROSC before 120 s with this seed; pick another seed");
    {
        const noFlow = 120;
        const last = Math.max(0.5, Math.min(1.5, (0.1 + (0 - 65) * (0.9 / 55)) * (30 / noFlow)));
        const cprTime = 120 - 0.2;
        const consistency = Math.min(1.2, last * (0.1 + (cprTime - 65) * (0.9 / 55)));
        const shock = Math.max(0.8, Math.min(1.7, 120 / (120 + 120)));
        const expected = 0.4 * 1 * 1 * consistency * 0.85 * shock * 1;
        assert.ok(Math.abs(seen - expected) < 1e-9, `chance ${seen} expected ${expected}`);
    }
});

test("a roll that falls during a pause ends the CPR roll loop until CPR is stopped and restarted", () => {
    const s = arrest(23);
    s.act("cprStart", { skill: 2 });
    s.run(20);
    s.act("cprPause");
    s.run(6); // a 5 s roll falls inside the pause
    s.act("cprResume");
    const before = s.p.lastCprChance;
    s.run(120);
    assert.equal(s.p.lastCprChance, before);
    assert.equal(s.timers.some((t) => t.kind === "cprRoll"), false);
});

test("shocking a patient with a pulse causes asystole and cardiac arrest", () => {
    const s = sim(30);
    s.run(5);
    s.act("shock");
    assert.equal(s.p.rhythm, "Asystole");
    s.run(1);
    assert.equal(s.p.hr, 0);
});

test("reversible arrest (PEA) from blood loss resolves when volume is restored above 4.2 L", () => {
    const s = sim(31);
    s.act("setState", { fields: { blood: 4.0 } });
    s.fatalVitals();
    assert.equal(s.p.rhythm, "PEA");
    s.act("setState", { fields: { blood: 5.0 } });
    s.run(6);
    assert.equal(s.p.cardiacArrest, false);
    assert.ok(s.events.some((e) => e.event === "rosc"));
});

test("patient cannot wake below 5.1 L blood volume", () => {
    const s = sim(32);
    s.act("setState", { fields: { blood: 5.0, unconscious: true } });
    s.run(300);
    assert.equal(s.p.unconscious, true);
});
