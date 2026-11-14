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
