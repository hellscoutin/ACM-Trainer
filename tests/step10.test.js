// Training program materials (ACM Training/Design/MATERIALS-design.md): scenario labels follow the program's module
// numbering, CLS-4 cardiac arrest and CM-4 access and drugs scenarios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSession } from "../engine/runner.js";
import { aedState } from "../engine/aed.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = read("../data/acm-1.4.8.json");
const meds = read("../data/medications-1.4.8.json");
const scenario = (id, seed) => { const scn = read(`../scenarios/${id}.json`); return createSession(scn, data, meds, { seed, rubric: read(`../${scn.rubric}`) }); };
const failed = (r) => r.results.filter((x) => x.status === "fail").map((x) => x.check.id);

test("every built-in scenario's module label is a module of its track in the program", () => {
    const modules = { "combat-lifesaver": /^CLS-[1-5]$/, "combat-medic": /^CM-[1-6][ab]?$/, "advanced-medic": /^AM-[1-5][ab]?$/ };
    for (const id of read("../scenarios/index.json").scenarios) {
        const s = read(`../scenarios/${id}.json`);
        assert.match(s.module, modules[s.track], `${id}: ${s.module}`);
    }
});

/** CPR, AED analyse and shock, back to CPR until the pulse returns; then clear the airway and ventilate. */
function arrestTextbook(s) {
    s.tick(3);
    s.act("checkpulse", "head");
    s.act("cpr", "body");
    s.act("aed_applypads", "body");
    s.sim.act("cprStop");
    s.act("aed_analyzerhythm", "body");
    for (let k = 0; k < 25 && !aedState(s.sim.p).charged; k++) s.tick(1);
    assert.ok(!s.act("aed_shock", "body").error);
    s.act("cpr", "body");
    for (let k = 0; k < 110 && s.sim.p.cardiacArrest; k++) s.tick(5);
    if (!s.sim.p.cardiacArrest) {
        s.sim.act("cprStop");
        s.act("checkairway", "head"); s.tick(3);
        s.act("headturn", "head"); s.tick(6);
        s.act("usesuctionbag", "head"); s.tick(15);
        s.act("insertopa", "head"); s.tick(4);
        s.act("usebvm", "head");
    }
    s.until(600);
}

test("CLS-4 arrest: CPR, AED shock, then airway and pocket BVM passes; doing nothing is a no-go", () => {
    const s = scenario("cls4-cardiac-arrest");
    arrestTextbook(s);
    const r = s.score();
    assert.equal(r.passed, true, failed(r).join(", "));
    const idle = scenario("cls4-cardiac-arrest");
    idle.until(600);
    const r2 = idle.score();
    assert.equal(r2.passed, false);
    assert.ok(failed(r2).includes("cpr-fast"));
});

test("CLS-4 arrest: the textbook sequence restarts the heart in most variations", () => {
    let rosc = 0;
    for (let seed = 1; seed <= 12; seed++) {
        const s = scenario("cls4-cardiac-arrest", seed);
        arrestTextbook(s);
        if (s.sim.events.some((e) => e.event === "rosc")) rosc++;
    }
    assert.ok(rosc >= 9, `ROSC in ${rosc} of 12`);
});

import { validateBank, drawTest, scoreTest, BANK_FORMAT } from "../engine/written-test.js";

const bank = {
    format: BANK_FORMAT, passMark: 0.8, testSize: { cls: 6 }, tracks: { cls: "Combat Lifesaver" },
    questions: ["A", "B", "C"].flatMap((m) => [1, 2, 3, 4].map((n) => ({ id: `${m}${n}`, track: "cls", module: m, type: n === 4 ? "multi" : "single",
        stem: `${m}${n}?`, options: ["w", "x", "y", "z"], answer: n === 4 ? [1, 2] : [n % 4], why: "because", guide: "Chapter 1" }))),
};

test("written test: a draw is deterministic per seed, spread over modules, and carries no answers", () => {
    validateBank(bank);
    const a = drawTest(bank, "cls", 42), b = drawTest(bank, "cls", 42);
    assert.deepEqual(a, b);
    assert.equal(a.length, 6);
    const perModule = a.reduce((m, q) => ({ ...m, [q.module]: (m[q.module] || 0) + 1 }), {});
    assert.deepEqual(Object.values(perModule).sort(), [2, 2, 2]);
    assert.ok(a.every((q) => !("answer" in q) && !("why" in q)));
    assert.notDeepEqual(drawTest(bank, "cls", 43).map((q) => q.id), a.map((q) => q.id));
});

test("written test: scoring maps shuffled options back; multi needs exactly the right set; pass mark 80 %", () => {
    const t = drawTest(bank, "cls", 7);
    const byId = Object.fromEntries(bank.questions.map((q) => [q.id, q]));
    const right = Object.fromEntries(t.map((q) => [q.id, byId[q.id].answer.map((a) => q.order.indexOf(a))]));
    assert.equal(scoreTest(bank, t, right).got, 6);
    assert.equal(scoreTest(bank, t, right).passed, true);
    const oneWrong = { ...right, [t[0].id]: [(right[t[0].id][0] + 1) % 4] };
    const r = scoreTest(bank, t, oneWrong);
    assert.equal(r.got, 5);
    assert.equal(r.need, 5);
    assert.equal(r.passed, true);
    const multi = t.find((q) => q.type === "multi");
    if (multi) assert.equal(scoreTest(bank, t, { ...right, [multi.id]: right[multi.id].slice(0, 1) }).got, 5);
    assert.equal(scoreTest(bank, t, {}).passed, false);
    assert.throws(() => validateBank({ format: "x" }));
});

/** Dress both arms, read the dog tag, IV in the left leg, B- and O- blood, one full morphine dose. */
function accessTextbook(s, bags = ["ACM_BloodBag_BN_500", "ACM_BloodBag_ON_500"]) {
    for (const part of ["rightarm", "rightarm", "leftarm", "leftarm"]) s.act("pressurebandage", part);
    s.act("checkdogtags", "head");
    assert.ok(!s.act("insertiv_16_middle", "leftleg").error);
    for (const b of bags) s.addBag("leftleg", 1, true, b);
    s.draw(10, "Morphine", 1.6);
    s.act("morphine_10_iv", "leftleg");
    s.until(900);
}

test("CM-4 access and drugs: textbook passes; A+ blood for a B- casualty is a critical no-go; idle fails", () => {
    let s = scenario("cm4-access-drugs");
    accessTextbook(s);
    let r = s.score();
    assert.equal(r.passed, true, failed(r).join(", "));
    assert.ok(s.sim.p.bloodVolume >= 5.1);
    s = scenario("cm4-access-drugs");
    accessTextbook(s, ["ACM_BloodBag_A_500"]);
    r = s.score();
    assert.ok(r.criticalFails.some((x) => x.check.id === "no-reaction"));
    s = scenario("cm4-access-drugs");
    s.until(900);
    assert.equal(s.score().passed, false);
});

test("CM-4: two quick morphine doses overdose (the trap the scenario teaches)", () => {
    const s = scenario("cm4-access-drugs");
    s.tick(20);
    s.act("insertiv_16_middle", "leftleg");
    for (let k = 0; k < 2; k++) { s.draw(10, "Morphine", 2); s.act("morphine_10_iv", "leftleg"); s.tick(20); }
    s.tick(120);
    const r = s.score();
    assert.ok(s.sim.events.some((e) => e.event === "overdose") === r.results.some((x) => x.check.id === "no-overdose" && x.status === "fail"));
});

import { buildFixtures } from "../tools/export_guidance_fixtures.mjs";

test("guidance fixtures for the ATAK patient monitor are up to date (node tools/export_guidance_fixtures.mjs)", () => {
    const file = read("../rules/fixtures.json");
    assert.deepEqual(JSON.parse(JSON.stringify(buildFixtures())), file);
    assert.ok(file.count > 100 && file.fixtures.some((f) => f.expect.length > 3));
});
