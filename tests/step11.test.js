// Review plan (docs/REVIEW-plan.md): body colours from ACE's palettes, the AED-cuff check, and the ACM actions added
// in phase 4 (shake and slap awake, ammonia inhalant, naloxone spray, adenosine autoinjector, wrap bruises, BVM with oxygen).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSession } from "../engine/runner.js";
import { bodyPartColors } from "../engine/injuryList.js";
import { aedState } from "../engine/aed.js";
import { wrapBruises, bruiseWrapTime, canWrapBruises } from "../engine/wounds.js";
import { shakeAwake, slapAwake } from "../engine/exams.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = read("../data/acm-1.4.8.json");
const meds = read("../data/medications-1.4.8.json");
const session = (over = {}, seed = 3) => createSession({ id: "t", title: "t", role: "medic", injuries: [], loadout: {}, ...over }, data, meds, { seed });
const bruise = (size, count, damage = 0.2) => ({ type: "Contusion", size, count, bleeding: 0, damage });

test("body colours use ACE's palettes: white unhurt, pale yellow to red for bleeding, pale cyan to blue for damage", () => {
    const s = session();
    const p = s.sim.p;
    assert.deepEqual(bodyPartColors(s.sim), Array(6).fill("rgb(255, 255, 255)"));
    p.openWounds.leftleg.push({ type: "Avulsion", size: 2, count: 1, bleeding: 0.5, damage: 1 });
    p.openWounds.leftarm.push({ type: "Cut", size: 0, count: 1, bleeding: 0.01, damage: 0.1 });
    p.bodyPartDamage[1] = 12 * 0.8; // torso at 80 % of the player threshold: full blue
    const c = bodyPartColors(s.sim);
    assert.equal(c[4], "rgb(255, 0, 0)");
    assert.equal(c[2], "rgb(255, 242, 163)"); // step 1
    assert.equal(c[1], "rgb(0, 0, 255)");
    p.ai = true; p.bodyPartDamage[1] = 7 * 0.8; // AI threshold 7
    assert.equal(bodyPartColors(s.sim)[1], "rgb(0, 0, 255)");
    p.ai = false;
    assert.notEqual(bodyPartColors(s.sim)[1], "rgb(0, 0, 255)");
});

test("a manual pressure cuff cannot go on the arm that carries the AED's cuff", () => {
    const s = session({ loadout: { ACM_PressureCuff: 1, ACM_AED: 1 } });
    aedState(s.sim.p).cuff = 2;
    assert.ok(s.act("pressurecuff_attach", "leftarm").error);
    assert.equal(s.act("pressurecuff_attach", "rightarm").error, undefined);
});

test("wrap bruises: one wrap treats 8 units, largest first, and gives the trauma back", () => {
    const s = session({ loadout: { ACM_ElasticWrap: 2 } });
    const p = s.sim.p;
    p.openWounds.body.push(bruise(2, 1, 0.4), bruise(1, 1, 0.2), bruise(0, 4, 0.05));
    p.bodyPartDamage[1] = 0.8;
    assert.ok(canWrapBruises(p, "body"));
    assert.equal(bruiseWrapTime(p, "body", 1), 8); // 4 + 2 + 4 = 10 units (under the cap of 12), medic -2
    assert.equal(bruiseWrapTime(p, "body", 0), 10);
    wrapBruises(s.sim, "body"); // large (4) + medium (2) + two small (2)
    assert.deepEqual(p.openWounds.body.map((w) => [w.size, w.count]), [[0, 2]]);
    assert.ok(Math.abs(p.bodyPartDamage[1] - (0.8 - 0.4 - 0.2 - 0.1)) < 1e-9);
    assert.equal(s.act("elasticwrap", "body").error, undefined);
    assert.equal(p.openWounds.body.length, 0);
    assert.equal(s.ctx.inventory.ACM_ElasticWrap, 1);
    assert.ok(s.act("elasticwrap", "body").error); // nothing left to wrap
});

test("shake and slap awake follow shakeAwakeLocal and slapAwakeLocal", () => {
    let woke = 0;
    for (let seed = 1; seed <= 200; seed++) {
        const s = session({}, seed);
        s.sim.setUnconscious(true);
        s.sim.p.knockOut = true;
        if (shakeAwake(s.sim).woke) { woke++; assert.equal(s.sim.p.unconscious, false); assert.equal(s.sim.p.knockOut, false); }
    }
    assert.ok(woke > 100 && woke < 180, `shake woke ${woke} of 200 (expect about 70 % at SpO2 99)`);
    woke = 0;
    for (let seed = 1; seed <= 200; seed++) {
        const s = session({}, seed);
        s.sim.setUnconscious(true);
        s.sim.p.knockOut = true;
        const r = slapAwake(s.sim);
        assert.equal(s.sim.p.knockOut, false);
        if (r.woke) woke++;
    }
    assert.ok(woke > 40 && woke < 120, `slap woke ${woke} of 200 (expect about 40 %)`);
    const s = session();
    assert.ok(s.act("shakeawake", "body").error, "not offered on an awake casualty");
    s.sim.setUnconscious(true);
    s.sim.p.surgicalAirway = true; // forced unconscious: never wakes
    for (let i = 0; i < 20; i++) assert.deepEqual(shakeAwake(s.sim).hint, ["You attempt to shake the patient awake", "Patient is still asleep"]);
});

test("new medication actions are offered with their items and consume them", () => {
    const s = session({ loadout: { ACM_Spray_Naloxone: 1, ACM_AmmoniaInhalant: 1, ACE_adenosine: 1 } });
    for (const [id, part, item] of [["naloxone", "head", "ACM_Spray_Naloxone"], ["ammoniainhalant", "head", "ACM_AmmoniaInhalant"], ["adenosine", "leftarm", "ACE_adenosine"]]) {
        assert.equal(s.act(id, part).error, undefined, id);
        assert.equal(s.ctx.inventory[item], 0, id);
        assert.ok(s.act(id, part).error, `${id} needs its item`);
    }
});

test("BVM with portable oxygen needs the tank and ventilates with oxygen", () => {
    const s = session({ loadout: { ACM_BVM: 1 } });
    s.sim.setUnconscious(true);
    assert.ok(s.act("usebvm_portableoxygen", "head").error);
    s.ctx.inventory.ACM_OxygenTank_425 = 1;
    assert.equal(s.act("usebvm_portableoxygen", "head").error, undefined);
    assert.equal(s.sim.p.bvm, true);
    assert.equal(s.sim.p.bvmOxygen, true);
});

test("triage card: treatments leave ACE's lines, repeated items are counted", async () => {
    const { triageCardLines } = await import("../engine/patient.js");
    const s = session({ loadout: { ACE_tourniquet: 2, ACE_morphine: 2, ACM_ChestSeal: 1, ACM_PressureBandage: 2 } });
    s.sim.p.chestInjury = true;
    assert.deepEqual(triageCardLines(s.sim.p), []);
    s.act("applytourniquet", "leftleg");
    s.act("morphine", "leftarm");
    s.act("morphine", "rightarm");
    s.act("applychestseal", "body");
    s.act("checkpulse", "head"); // examinations and bandages leave no line
    const lines = triageCardLines(s.sim.p);
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^1x - Tourniquet \(CAT\) \(\d+m\)$/);
    assert.match(lines[1], /^2x - Morphine Autoinjector \(0m\)$/);
    assert.match(lines[2], /^1x - Chest Seal \(0m\)$/);
});
