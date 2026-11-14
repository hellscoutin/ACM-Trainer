// Headless trainee session: performs menu actions with their real durations, keeps inventory and the treatment log,
// records history and scores against the rubric. Used by tests and (later) for replays and instructor re-simulation.
import { loadScenario, runTimeline, ROLE_LEVEL } from "./scenario.js";
import { buildCatalogue, available, actionTime, pickItem, markTreated } from "./menu.js";
import { addBag as attachBag } from "./circulation.js";
import { drawSyringe } from "./syringes.js";
import { updatePulseOximeters } from "./exams.js";
import { createRecorder, scoreRun } from "./scoring.js";

export function createSession(scn, data, meds, { seed, rubric } = {}) {
    const sim = loadScenario(scn, data, meds, { seed });
    const catalogue = buildCatalogue(data);
    const ctx = { sim, level: ROLE_LEVEL[scn.role || "anyone"], inventory: { ...(scn.loadout || {}) }, name: "You", patientName: "Patient", busy: null };
    const recorder = createRecorder(sim);
    const tick = (n = 1) => {
        for (let i = 0; i < n && sim.p.alive; i++) {
            sim.tick();
            runTimeline(sim);
            updatePulseOximeters(sim);
            recorder.tick();
        }
    };
    const until = (t) => { while (sim.p.t < t && sim.p.alive) tick(1); };
    /** Performs a menu action: waits its duration, re-checks it, runs it. Returns the action result or { error }. */
    const act = (id, part) => {
        const a = catalogue.find((x) => x.id === id);
        if (!a) throw new Error("Unknown action " + id);
        const why = available(ctx, a, part);
        if (why) return { error: why };
        const item = pickItem(ctx, a);
        const t = a.continuous ? 0 : actionTime(ctx, a, part);
        tick(Math.ceil(t));
        const again = available(ctx, a, part);
        if (again) return { error: again };
        ctx.label = a.label;
        const r = a.run(ctx, part) || {};
        if (item && a.consumes && !r.refund) ctx.inventory[item] = Math.max(0, (ctx.inventory[item] || 0) - 1);
        if (a.returnsItem) ctx.inventory[a.returnsItem] = (ctx.inventory[a.returnsItem] || 0) + 1;
        for (const c of r.give || []) ctx.inventory[c] = (ctx.inventory[c] || 0) + 1;
        if (!r.refund) markTreated(sim, a);
        recorder.action(id, part, !r.refund);
        return r;
    };
    /** Transfusion menu: add a bag from the inventory (5 s). */
    const addBag = (part, site, iv, cls) => {
        if ((ctx.inventory[cls] || 0) < 1) return { error: "No such bag" };
        tick(5);
        const r = attachBag(sim, part, site, iv, cls);
        if (r.ok) ctx.inventory[cls]--;
        recorder.action("addbag", part, r.ok, { cls });
        return r;
    };
    /** Syringe draw window: draw a vial into an empty syringe (4 s). */
    const draw = (size, drug, ml) => { tick(4); const r = drawSyringe(ctx, size, drug, ml); recorder.action("drawsyringe", null, r.ok, { drug, size, ml }); return r; };
    const score = () => scoreRun(rubric, sim, recorder);
    return { sim, ctx, recorder, catalogue, tick, until, act, addBag, draw, score };
}
