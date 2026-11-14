// Examinations. Ports: circulation/feelPulse (per-frame part), checkCapillaryRefillLocal; ACE checkResponse
// (advancedDiagnose default 2); breathing/getSpO2 and handlePulseOximeter; dog tag text.
import { lin, PART_INDEX } from "./util.js";
import { hasPulse } from "./vitals.js";

const PULSE_SITE = { head: "carotid", leftarm: "radial", rightarm: "radial", leftleg: "femoral", rightleg: "femoral" };
const PULSE_CUTOFF = [60, 0, 80, 80, 70, 70];

/**
 * Feel Pulse at one site, read live while the window is open.
 * Returns { site, rate (bpm, 0 = nothing felt), strength 0..3 (beat size in the game's heart icon) }.
 */
export function feelPulse(sim, part) {
    const { p } = sim;
    const i = PART_INDEX[part];
    let hr = p.hr;
    const systolic = p.bp[1];
    const cutoff = PULSE_CUTOFF[i];
    const palpable = hasPulse(p, true);
    if (p.tourniquets[i] || (!palpable && i !== 0)) hr = 0;
    if (hr <= 0 || cutoff > systolic || !p.alive) return { site: PULSE_SITE[part], rate: 0, strength: 0 };
    const mod = palpable || i === 0 ? (palpable ? 1 : 0.6) : 0.6;
    return { site: PULSE_SITE[part], rate: hr, strength: lin(cutoff, cutoff + 60, systolic * mod, 0.8, 3) };
}

/** checkCapillaryRefillLocal (torso and arms). Returns the hint and the log text. */
export function capillaryRefill(sim, part) {
    const { p } = sim;
    const i = PART_INDEX[part];
    let crt = 4;
    const bv = p.bloodVolume;
    if (hasPulse(p)) {
        if (i === 2 || i === 3) { if (!p.tourniquets[i]) crt = lin(5.8, 5.2, bv, 2, 4, false); }
        else crt = lin(5.5, 4.8, bv, 2, 4, false);
    }
    const m = p.bp[0] + (p.bp[1] - p.bp[0]) / 3;
    if (bv > 5) crt += m > 95 ? lin(95, 110, m, 0, -2) : lin(87, 70, m, 0, 2);
    const v = crt < 2 ? "~2" : crt < 3 ? "<3" : crt < 4 ? "~3" : ">4";
    const where = part === "body" ? "Torso" : part === "leftarm" ? "Left Arm" : "Right Arm";
    return { hint: ["Measured Capillary Refill Time", `${v} seconds`], log: `measured capillary refill time: ${v}s (${where})` };
}

/** ACE checkResponse with advancedDiagnose = 2 (the ACE default). */
export function checkResponse(sim, name = "Patient") {
    const { p } = sim;
    let s;
    if (!p.unconscious && p.alive) s = `${name} is responsive`;
    else if (p.cardiacArrest && p.alive) s = `${name} is not responsive, taking shallow gasps and convulsing`;
    else if (!p.alive) s = `${name} is not responsive, motionless and cold`;
    else s = `${name} is not responsive`;
    return { hint: [s], log: s };
}

export function checkDogTag(sim, name = "Patient") {
    const { p } = sim;
    const s = `${name}, blood type ${p.bloodType}, ${Math.round(p.weight)} kg`;
    return { hint: [s], log: `Dog tag: ${s}` };
}

/** breathing/getSpO2 (inaccurate reading) */
export function readSpO2(sim) {
    const { p, rng } = sim;
    const o = p.spo2;
    const range = lin(95, 75, o, 1, 5, false);
    const bloodLoss = lin(5.5, 3, p.bloodVolume, 0, 25);
    const bpEffect = lin(90, 80, p.bp[1], 0, 15);
    if (!p.alive || p.hr < 20 || p.bp[1] < 80) return 0;
    return Math.min(100, rng.tri(Math.max(0, o - range), o, Math.min(99, o + range)) - bloodLoss * (o / p.targets.spo2) + bpEffect);
}

/** handlePulseOximeter: refresh each placed oximeter's display every 3 s. Call once per second. */
export function updatePulseOximeters(sim) {
    const { p } = sim;
    p.pulseOxDisplay ??= [[0, 0], [0, 0]];
    p.pulseOxSync ??= [-1, -1];
    for (const side of [0, 1]) {
        if (!p.pulseOx[side]) { p.pulseOxDisplay[side] = [0, 0]; continue; }
        if (p.pulseOxSync[side] + 3 >= p.t) continue;
        p.pulseOxSync[side] = p.t;
        if (!p.tourniquets[side + 2] && p.bp[1] >= 80 && hasPulse(p, true)) {
            let pr = p.hr, sp = 0;
            if (pr < 30) pr = 0; else sp = readSpO2(sim);
            p.pulseOxDisplay[side] = [Math.round(sp), Math.round(pr)];
        } else p.pulseOxDisplay[side] = [0, 0];
    }
}
