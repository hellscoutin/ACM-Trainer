// Instructor-led sessions (docs/TRAINER-design.md section 5.1): instructor injects applied to the trainee's simulation,
// and the live snapshot the trainee client publishes for the instructor's dashboard. Firestore itself lives in app/js.
import { BODY_PARTS, PART_INDEX } from "./util.js";
import { applyDamage } from "./damage.js";
import { MECHANISM_NAMES, captureFrame } from "./custom.js";
import { handlePneumothorax, updateLungState } from "./breathing.js";

/** Injects an instructor can send, with the arguments the dashboard asks for. */
export const INJECTS = {
    vomit: { label: "Vomits now", args: [] },
    wound: { label: "New hit", args: ["part", "mechanism", "damage"] },
    tourniquetSlip: { label: "Tourniquet slips off", args: ["part"] },
    pneumothorax: { label: "Pneumothorax gets worse (one level)", args: [] },
    tension: { label: "Tension pneumothorax", args: [] },
    unconscious: { label: "Goes unconscious", args: [] },
    wake: { label: "Wakes up", args: [] },
    arrest: { label: "Cardiac arrest", args: [] },
};
/** Values the instructor can set directly (like a Zeus module). */
export const SETTABLE = {
    blood: { label: "Blood volume (L)", min: 2.5, max: 6, step: 0.1 },
    spo2: { label: "SpO2 (%)", min: 40, max: 100, step: 1 },
    pain: { label: "Pain (0-1)", min: 0, max: 1, step: 0.05 },
    internalBleeding: { label: "Internal bleeding (L/min)", min: 0, max: 0.5, step: 0.01 },
};

/** Applies an inject to the simulation. Returns a short text for the trainee's timeline (the trainee is not told what it was). */
export function applyInject(sim, kind, args = {}) {
    const p = sim.p;
    if (!p.alive) return null;
    switch (kind) {
        case "vomit":
            if (!p.unconscious) return null;
            p.vomitGrace = p.t;
            sim.emit("vomit", { obstructs: !p.recoveryPosition });
            if (!p.recoveryPosition && p.airwayOral !== "SGA") p.obstructionVomit++;
            return "Vomited";
        case "wound": {
            const part = BODY_PARTS.includes(args.part) ? args.part : "body";
            const mech = MECHANISM_NAMES[args.mechanism] ? args.mechanism : "bullet";
            const made = applyDamage(sim, part, mech, Math.max(0.05, Math.min(10, Number(args.damage) || 1)));
            return `New injury (${MECHANISM_NAMES[mech]}, ${made.length} wound${made.length === 1 ? "" : "s"})`;
        }
        case "tourniquetSlip": {
            const part = args.part && p.tourniquets[PART_INDEX[args.part]] ? args.part : BODY_PARTS.find((x, i) => p.tourniquets[i]);
            if (!part) return null;
            sim.act("removeTourniquet", { part });
            return "Tourniquet slipped";
        }
        case "pneumothorax":
            p.chestInjury = true;
            handlePneumothorax(sim);
            updateLungState(sim);
            return `Pneumothorax level ${p.ptx}${p.tensionPtx ? " (tension)" : ""}`;
        case "tension":
            p.chestInjury = true;
            for (let i = 0; i < 6 && !p.tensionPtx; i++) handlePneumothorax(sim);
            updateLungState(sim);
            return "Tension pneumothorax";
        case "unconscious": if (!p.unconscious) sim.criticalVitals(); return "Went unconscious";
        case "wake": if (p.unconscious && !p.cardiacArrest) sim.wakeUp(); return "Woke up";
        case "arrest": if (!p.cardiacArrest) sim.fatalVitals(); return "Cardiac arrest";
        default: return null;
    }
}
export function applySet(sim, field, value) {
    const s = SETTABLE[field];
    if (!s) return null;
    const v = Math.max(s.min, Math.min(s.max, Number(value)));
    if (!Number.isFinite(v)) return null;
    sim.act("setState", { fields: { [field]: v } });
    return `${s.label} set to ${v}`;
}

/** Alerts shown on the instructor's tile. */
export function alerts(sim) {
    const p = sim.p, a = [];
    if (!p.alive) return ["Dead"];
    if (p.cardiacArrest) a.push(`Cardiac arrest (${p.rhythm})`);
    else if (p.hr < 1) a.push("No pulse");
    if (p.spo2 < 85) a.push(`SpO2 ${Math.round(p.spo2)} %`);
    if (p.bloodVolume < 4.2) a.push(`Blood ${p.bloodVolume.toFixed(1)} L`);
    if (p.woundBleeding > 0.1) a.push("Heavy bleeding");
    if (p.tensionPtx) a.push("Tension pneumothorax");
    if (p.obstructionVomit + p.obstructionBlood > 0) a.push("Airway obstructed");
    if ((p.reactionSeverity || 0) > 0) a.push("Hemolytic reaction");
    if (p.cbrn?.spasm) a.push("Airway spasm");
    return a;
}

/** What the trainee publishes every 2 s: status, true vitals, alerts, recent actions and a replay frame (the mirror view). */
export function snapshot(sim, { status, current = null, hints = 0, actions = [] } = {}) {
    const p = sim.p;
    return {
        status, t: p.t, current, hints,
        alive: p.alive, unconscious: !!p.unconscious, cardiacArrest: !!p.cardiacArrest, rhythm: p.rhythm,
        vitals: { hr: Math.round(p.hr), sys: Math.round(p.bp[1]), dia: Math.round(p.bp[0]), spo2: Math.round(p.spo2), rr: Math.round(p.rr), bv: Math.round(p.bloodVolume * 100) / 100,
            bleeding: Math.round(p.woundBleeding * 1000), ib: Math.round(p.internalBleeding * 1000) },
        alerts: alerts(sim), actions: actions.slice(-40),
        frame: JSON.stringify(captureFrame(sim)), // a string: Firestore cannot store the frame's nested arrays
    };
}
