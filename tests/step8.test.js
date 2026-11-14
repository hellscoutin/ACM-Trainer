// Step 8: guidance rules and the knowledge view behind hints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSession } from "../engine/runner.js";
import { knowledgeView, evaluateGuidance, testRule, LIMBS } from "../engine/guidance.js";
import { BODY_PARTS } from "../engine/util.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = read("../data/acm-1.4.8.json");
const meds = read("../data/medications-1.4.8.json");
const rules = read("../rules/guidance.json");
const session = (id, seed) => createSession(read(`../scenarios/${id}.json`), data, meds, { seed });
const ids = (s, depth) => evaluateGuidance(rules, s.sim, { depth, level: s.ctx.level }).map((g) => g.rule);
const GUIDE_CHAPTERS = ["The patient model", "The medical menu", "Assessment", "External bleeding", "Internal bleeding, platelets and TXA", "How airways fail",
    "Airway management", "Assessing breathing", "Chest injuries", "Chest treatment", "Ventilation and oxygen", "IV and IO access", "Fluids and blood", "Medications",
    "Cardiac arrest", "Fractures", "Pain and consciousness"];

function fieldsOf(pred, out = new Set()) {
    if (pred.all || pred.any) for (const x of pred.all || pred.any) fieldsOf(x, out);
    else if (pred.not) fieldsOf(pred.not, out);
    else out.add(pred.field);
    return out;
}

test("rules file: every field a rule tests exists in the Advanced view, ids unique, guide chapters real", () => {
    const s = session("cm4-hemothorax");
    const v = knowledgeView(s.sim, 3, { level: 2 });
    const parts = { parts: BODY_PARTS, limbs: LIMBS, core: ["head", "body"] };
    const seen = new Set();
    for (const r of rules.rules) {
        assert.ok(!seen.has(r.id), `duplicate ${r.id}`); seen.add(r.id);
        assert.ok(GUIDE_CHAPTERS.includes(r.guide), `${r.id}: unknown guide chapter ${r.guide}`);
        for (const f of fieldsOf(r.when)) for (const part of r.each ? parts[r.each] : [null]) {
            const name = part ? f.replace("{part}", part) : f;
            assert.ok(name in v, `${r.id}: field ${name} is not in the view`);
        }
        for (const m of r.text.matchAll(/\{(\w+)\}/g)) if (!["part", "Part"].includes(m[1])) assert.ok(m[1] in v, `${r.id}: text field ${m[1]}`);
    }
    const sqf = readFileSync(new URL("../rules/guidance.sqf", import.meta.url), "utf8");
    assert.equal((sqf.match(/^ {4}\["/gm) || []).length, rules.rules.length, "guidance.sqf is out of date: run tools/build_guidance.py");
});

test("knowledge view: depths hide what the player cannot know", () => {
    const s = session("cm1-hemorrhagic-shock");
    const v1 = knowledgeView(s.sim, 1), v3 = knowledgeView(s.sim, 3);
    assert.equal(v1.spo2, null, "no pulse oximeter, no SpO2");
    assert.ok(!("bloodVolume" in v1) && !("f_uneven" in v1));
    assert.ok(v3.bloodVolume < 6);
    s.act("placepulseoximeter", "rightarm");
    s.tick(5);
    assert.ok(knowledgeView(s.sim, 1).spo2 > 0, "pulse oximeter reading shows");
});

test("null-safe comparisons: a missing reading never matches < or >", () => {
    assert.equal(testRule({ field: "spo2", op: "<", value: 90 }, { spo2: null }), false);
    assert.equal(testRule({ field: "spo2", op: ">", value: 90 }, {}), false);
    assert.equal(testRule({ field: "spo2", op: "!=", value: 90 }, { spo2: null }), true);
});

test("bleeding: tourniquet prompt for the heavy limb, gone once applied", () => {
    const s = session("cls1-leg-hemorrhage");
    s.tick(2);
    let g = evaluateGuidance(rules, s.sim, { depth: 1, level: 0 });
    assert.equal(g[0].id, "m-tourniquet:leftleg");
    assert.match(g[0].text, /left leg/);
    s.act("applytourniquet", "leftleg");
    assert.ok(!ids(s, 1).includes("m-tourniquet"));
});

test("findings: no carotid pulse shows at Intermediate only; the arrest procedure at Advanced hides it", () => {
    const s = session("cm5-cardiac-arrest");
    s.tick(2);
    s.act("checkpulse", "head");
    assert.ok(!ids(s, 1).includes("i-no-carotid"));
    assert.ok(ids(s, 2).includes("i-no-carotid"));
    const adv = ids(s, 3);
    assert.ok(adv.includes("x-arrest-shock"));
    assert.ok(!adv.includes("i-no-carotid"), "superseded");
});

test("chest: shallow breathing with a torso wound suggests a seal; tension asks for the seal before NCD", () => {
    let s = session("cls3-chest-gunshot");
    s.tick(2);
    s.act("checkbreathing", "head");
    assert.ok(ids(s, 2).includes("i-shallow-chest"));
    assert.ok(ids(s, 3).includes("x-open-ptx") && !ids(s, 3).includes("i-shallow-chest"));
    s = session("cm2-tension-chest");
    s.sim.p.tensionPtx = true;
    assert.ok(ids(s, 3).includes("x-tension-noseal"));
    s.act("applychestseal", "body");
    s.sim.p.tensionPtx = true;
    assert.ok(ids(s, 3).includes("x-tension"));
});

test("reversible arrest (PEA) gets the fix-the-cause procedure, not CPR-and-shock", () => {
    const s = session("cm5-cardiac-arrest");
    s.sim.p.rhythm = "PEA";
    const g = evaluateGuidance(rules, s.sim, { depth: 3, level: 1 });
    assert.equal(g[0].rule, "x-arrest-pea");
    assert.match(g[0].text, /4\.2 L/);
});

test("training level filters rules: a combat lifesaver is told to get a medic for tension", () => {
    const s = session("cm2-tension-chest");
    s.sim.p.findings = { t: { inspectchest: s.sim.p.t }, deviation: true };
    assert.ok(evaluateGuidance(rules, s.sim, { depth: 2, level: 0 }).some((g) => g.rule === "i-deviation-cls"));
    assert.ok(!evaluateGuidance(rules, s.sim, { depth: 2, level: 1 }).some((g) => g.rule === "i-deviation-cls"));
});

test("a dead casualty only gets the dead rule", () => {
    const s = session("cls1-leg-hemorrhage");
    s.sim.die("test");
    assert.deepEqual(ids(s, 3), ["dead"]);
});
