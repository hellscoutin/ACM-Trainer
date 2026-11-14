// Scenario loader: builds a Simulation from a scenario file (see docs/TRAINER-design.md section 4).
import { Simulation } from "./sim.js";
import { handlePneumothorax, handleHemothorax, updateLungState } from "./breathing.js";

/**
 * scenario: {
 *   id, title, track, module, seed, timeLimit,
 *   patient: { weight, bloodType, conscious },
 *   injuries: [{ part, type, damage, count }]      damage per wound (ACE damage units; ~0.2 minor, ~0.6 medium, ~1.2 large)
 *   chest: { ptx, htx }                            optional starting chest injury
 *   state: { field: value }                        optional direct state (e.g. blood: 5.2)
 *   settings: { ACM variable: value }, aceSettings: { name: value },
 *   role: "anyone" | "medic" | "doctor", loadout: { item class: count },
 *   timeline: [{ at, action, args }]               scripted events (sim actions)
 * }
 */
export function loadScenario(scn, data, meds, { seed } = {}) {
    const sim = new Simulation({
        data, meds, seed: seed ?? scn.seed ?? 1,
        settings: scn.settings || {}, aceSettings: scn.aceSettings || {},
        patient: { weight: scn.patient?.weight, bloodType: scn.patient?.bloodType },
    });
    for (const w of scn.injuries || []) sim.act("wound", { part: w.part, type: w.type, damage: w.damage, count: w.count || 1 });
    if (scn.chest) {
        const p = sim.p;
        p.chestInjury = true;
        if (scn.chest.ptx) chest(sim, "ptx", scn.chest.ptx);
        if (scn.chest.htx) chest(sim, "htx", scn.chest.htx);
    }
    if (scn.state) sim.act("setState", { fields: scn.state });
    if (scn.patient?.conscious === false) sim.criticalVitals();
    if (scn.arrest) { sim.p.targetRhythm = scn.arrest; sim.fatalVitals(); } // start in cardiac arrest with this rhythm (VF, PVT, Asystole)
    sim.timeline = [...(scn.timeline || [])].sort((a, b) => a.at - b.at);
    sim.scenario = scn;
    return sim;
}

function chest(sim, kind, level) {
    if (kind === "ptx") for (let i = 0; i < level; i++) handlePneumothorax(sim);
    else for (let i = 0; i < level; i++) handleHemothorax(sim);
    updateLungState(sim);
}

/** Applies due timeline entries; call after each tick. */
export function runTimeline(sim) {
    while (sim.timeline?.length && sim.timeline[0].at <= sim.p.t) {
        const e = sim.timeline.shift();
        sim.act(e.action, e.args || {});
    }
}

export const ROLE_LEVEL = { anyone: 0, medic: 1, doctor: 2 };
