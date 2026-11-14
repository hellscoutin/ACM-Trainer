// Rubric engine and the built-in rubrics: textbook play passes, poor play fails, with the expected checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSession } from "../engine/runner.js";
import { evaluateCheck, test as pred } from "../engine/scoring.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = read("../data/acm-1.4.8.json");
const meds = read("../data/medications-1.4.8.json");
const session = (id, seed) => {
    const scn = read(`../scenarios/${id}.json`);
    return createSession(scn, data, meds, { seed, rubric: read(`../${scn.rubric}`) });
};
const failedIds = (res) => res.results.filter((r) => r.status === "fail").map((r) => r.check.id);

test("predicates: all / any / not and operators", () => {
    const s = { a: 1, b: true, c: 5 };
    assert.equal(pred({ all: [{ field: "a", op: "==", value: 1 }, { field: "c", op: ">", value: 3 }] }, s), true);
    assert.equal(pred({ any: [{ field: "a", op: "<", value: 0 }, { not: { field: "b", value: false } }] }, s), true);
});

test("check types evaluate against log, events and history", () => {
    const ctx = {
        log: [{ t: 10, id: "applytourniquet", part: "leftleg", ok: true, state: { bleeding_leftleg: 0.2 } }],
        events: [{ t: 50, event: "vomit" }],
        history: [{ t: 0, spo2: 99 }, { t: 1, spo2: 70 }, { t: 2, spo2: 75 }, { t: 3, spo2: 95 }],
        end: { alive: true },
    };
    assert.equal(evaluateCheck({ type: "action-within", actions: ["applytourniquet"], within: 30 }, ctx).status, "pass");
    assert.equal(evaluateCheck({ type: "action-within", actions: ["applytourniquet"], within: 5 }, ctx).status, "fail");
    assert.equal(evaluateCheck({ type: "action-before-event", actions: ["applytourniquet"], event: "vomit" }, ctx).status, "pass");
    assert.equal(evaluateCheck({ type: "state-duration-max", state: { field: "spo2", op: "<", value: 80 }, max: 1 }, ctx).status, "fail");
    assert.equal(evaluateCheck({ type: "state-within", from: { event: "tensionPneumothorax" }, state: {}, within: 1 }, ctx).status, "na");
    assert.equal(evaluateCheck({ type: "action-forbidden", actions: ["applytourniquet"], when: { field: "bleeding_leftleg", op: ">", value: 0 } }, ctx).status, "fail");
});

test("CLS-2 leg bleed: textbook play passes; doing nothing is a no-go", () => {
    let s = session("cls1-leg-hemorrhage");
    s.tick(3);
    assert.ok(!s.act("applytourniquet", "leftleg").error);
    assert.ok(!s.act("pressurebandage", "rightarm").error);
    assert.ok(!s.act("paracetamol", "head").error);
    s.until(300);
    let r = s.score();
    assert.equal(r.passed, true, failedIds(r).join(", "));

    s = session("cls1-leg-hemorrhage");
    s.until(300);
    r = s.score();
    assert.equal(r.passed, false);
    assert.ok(r.criticalFails.some((x) => x.check.id === "tq-fast"));
});

test("CLS-3 blast: recovery position early passes; late fails the critical check", () => {
    let s = session("cls2-unconscious-airway");
    s.act("checkresponse", "head");
    s.act("checkbreathing", "head");
    s.act("pressurebandage", "leftarm");
    s.act("recoveryposition", "body");
    s.until(600);
    let r = s.score();
    assert.equal(r.passed, true, failedIds(r).join(", "));

    s = session("cls2-unconscious-airway");
    s.until(200);
    s.act("recoveryposition", "body");
    s.until(600);
    r = s.score();
    assert.ok(failedIds(r).includes("recovery"));
    assert.equal(r.passed, false);
});

test("CLS-4 chest: seal first passes", () => {
    const s = session("cls3-chest-gunshot");
    s.act("applychestseal", "body");
    s.act("pressurebandage", "rightleg");
    s.act("placepulseoximeter", "leftarm");
    s.until(480);
    const r = s.score();
    assert.equal(r.passed, true, failedIds(r).join(", "));
});

test("CM-2 shock: tourniquet, IV, O- blood passes; A+ patient given B+ blood is a no-go", () => {
    let s = session("cm1-hemorrhagic-shock");
    s.act("applytourniquet", "leftleg");
    assert.ok(!s.act("insertiv_16_middle", "rightarm").error);
    s.addBag("rightarm", 1, true, "ACM_BloodBag_ON_500");
    s.addBag("rightarm", 1, true, "ACM_BloodBag_ON_500");
    s.addBag("rightarm", 1, true, "ACE_salineIV");
    s.act("emergencytraumadressing", "leftleg");
    s.act("pressurecuff_attach", "leftarm");
    s.act("measurebloodpressure", "leftarm");
    s.until(600);
    let r = s.score();
    assert.equal(r.passed, true, failedIds(r).join(", "));

    s = session("cm1-hemorrhagic-shock");
    s.act("applytourniquet", "leftleg");
    s.act("insertiv_16_middle", "rightarm");
    s.ctx.inventory.ACM_BloodBag_B_500 = 1;
    s.addBag("rightarm", 1, true, "ACM_BloodBag_B_500");
    s.until(600);
    r = s.score();
    assert.ok(r.criticalFails.some((x) => x.check.id === "no-reaction"));
});

test("CM-3 tension: seal early passes with decompression not applicable; NCD without tension is penalised", () => {
    let s = session("cm2-tension-chest");
    s.act("checkbreathing", "head");
    s.act("applychestseal", "body");
    s.until(600);
    let r = s.score();
    assert.equal(r.results.find((x) => x.check.id === "decompress").status, "na");
    assert.equal(r.passed, true, failedIds(r).join(", "));

    s = session("cm2-tension-chest");
    s.act("performncd", "body");
    s.until(60);
    r = s.score();
    assert.ok(failedIds(r).includes("no-ncd"));
});
