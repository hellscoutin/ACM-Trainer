// AED / monitor. Ports ACM_circulation: setAEDLocal, handleAED (display refresh), AED_AnalyzeRhythm, AED_MotionDetected,
// AED_BeginCharge (auto and manual, 30 s timeout), AED_CancelCharge, AED_TrackCPR (metronome, re-analyze reminder),
// AED_AdministerShock (device part; effects in vitals.administerShock), AED_MeasureBP, getEKGHeartRate, getEtCO2,
// and the action conditions (AED_Can*). Voice prompts and tones are emitted as "aedSound" events for the UI.
import { lin, PART_INDEX } from "./util.js";
import { hasPulse, administerShock, recentAEDShock } from "./vitals.js";
import { airwayState, breathingState } from "./oxygen.js";
import { readSpO2 } from "./exams.js";
import { effectiveBloodVolume, painPerceived } from "./patient.js";

export function aedState(p) {
    p.aed ??= {
        pads: false, po: -1, cuff: -1, capno: false, charged: false, inUse: false, busy: false, analyzeState: false,
        tracking: false, trackUntil: -1, cuffBusy: false, mutedCPR: false, message: "", epoch: 0,
        display: { hr: 0, spo2: 0, bp: [0, 0], rr: 0, co2: 0 }, sync: { pads: -1e9, po: -1e9, capno: -1e9 }, ekgHR: null,
    };
    return p.aed;
}
const sound = (sim, name) => sim.emit("aedSound", { name });
export const hasAED = (p) => { const a = aedState(p); return a.pads || a.po !== -1 || a.cuff !== -1 || a.capno; };

// ------------------------------------------------------------------ connections (setAEDLocal)
export function connect(sim, type, part) {
    const a = aedState(sim.p);
    const i = part ? PART_INDEX[part] : -1;
    if (type === "pads") { a.pads = true; a.sync.pads = -1e9; a.display.hr = 0; sim.p.shockTotal = 0; }
    if (type === "po") { a.po = i; a.sync.po = -1e9; a.display.spo2 = 0; }
    if (type === "cuff") { a.cuff = i; a.display.bp = [0, 0]; }
    if (type === "capno") { a.capno = true; a.sync.capno = -1e9; a.display.rr = 0; a.display.co2 = 0; }
    // handleAED: alarm if the rhythm needs attention when first connected
    if (["Asystole", "VF", "PVT", "VT"].includes(sim.p.rhythm) && type === "pads") sim.schedule(5, "aedConnectPrompt", {});
    return { ok: true };
}
export function disconnect(sim, type) {
    const a = aedState(sim.p);
    if (type === "pads") { a.pads = false; a.display.hr = 0; a.charged = false; a.inUse = false; a.busy = false; a.tracking = false; a.message = ""; a.epoch++; }
    if (type === "po") { a.po = -1; a.display.spo2 = 0; }
    if (type === "cuff") { a.cuff = -1; a.display.bp = [0, 0]; }
    if (type === "capno") { a.capno = false; a.display.rr = 0; a.display.co2 = 0; }
    return { ok: true };
}

// ------------------------------------------------------------------ conditions (AED_Can*)
export const canAnalyze = (p) => aedState(p).pads && !aedState(p).inUse;
export const canManualCharge = canAnalyze;
export const canShock = (p) => aedState(p).pads && aedState(p).inUse && aedState(p).charged;
export const canCancelCharge = canShock;
export const canMeasureBP = (p) => aedState(p).cuff !== -1 && !aedState(p).inUse && !aedState(p).cuffBusy;

// ------------------------------------------------------------------ analyze, charge, shock
export function analyze(sim, retry = false) {
    const { p, rng } = sim;
    const a = aedState(p);
    if (a.tracking || (a.busy && !retry)) return false;
    a.analyzeState = false;
    a.inUse = true;
    a.busy = true;
    a.message = "ANALYZING NOW";
    const time = 4 + rng.random(4) + 4 * (1 - p.bloodVolume / 7);
    sound(sim, "aed_analyzingnow");
    sim.schedule(1, "aedAnalyzeTick", { doneAt: p.t + time, epoch: a.epoch });
    return true;
}
function beginCharge(sim, manual) {
    const a = aedState(sim.p);
    if (manual) a.inUse = true;
    sound(sim, "aed_charging");
    a.charged = false;
    a.message = "CHARGING";
    sim.schedule(4.1, "aedCharged", { manual, epoch: a.epoch });
}
export const manualCharge = (sim) => { beginCharge(sim, true); return true; };
export function cancelCharge(sim) {
    const a = aedState(sim.p);
    sound(sim, "aed_3beep");
    a.charged = false; a.inUse = false; a.analyzeState = false; a.message = "";
    return true;
}
function trackCPR(sim) {
    const a = aedState(sim.p);
    a.tracking = true;
    a.trackUntil = sim.p.t + 2 + 120;
    sim.schedule(120, "aedRecheckPrompt", { epoch: a.epoch });
}
/** AED_AdministerShock: device part, then the patient effects (vitals.administerShock). */
export function shock(sim) {
    const a = aedState(sim.p);
    a.charged = false;
    a.inUse = false;
    a.message = "";
    if (a.analyzeState) {
        sim.schedule(2, "aedTrackCPR", { epoch: a.epoch });
        a.busy = true;
        sim.schedule(4, "aedNotBusy", { epoch: a.epoch });
        a.analyzeState = false;
    }
    sim.emit("aedSound", { name: `shock_jolt${1 + Math.floor(sim.rng.random(4))}` });
    administerShock(sim);
    return true;
}
export function measureBP(sim) {
    const { p, rng } = sim;
    const a = aedState(p);
    a.cuffBusy = true;
    sound(sim, "aed_pressurecuff");
    sim.schedule(4 + rng.random(4), "aedBPDone", { epoch: a.epoch });
    return true;
}

export const aedTimers = {
    aedConnectPrompt(sim) { const a = aedState(sim.p); if (a.pads && !a.inUse) sound(sim, "aed_pushanalyze"); },
    aedAnalyzeTick(sim, { doneAt, epoch }) {
        const { p } = sim;
        const a = aedState(p);
        if (epoch !== a.epoch) return;
        if (!a.pads || !a.busy) { sound(sim, "aed_3beep"); a.inUse = false; a.busy = false; a.message = ""; return; }
        if (p.cpr || p.bvm) {
            // AED_MotionDetected: wait for 2 s without CPR/BVM, then re-analyze after 1.5 s
            a.message = "MOTION DETECTED";
            sim.schedule(0.3, "aedSay", { name: "aed_motiondetected" });
            sim.schedule(1, "aedMotionTick", { lastMotion: p.t, epoch });
            return;
        }
        if (p.t < doneAt) { sim.schedule(1, "aedAnalyzeTick", { doneAt, epoch }); return; }
        a.analyzeState = true;
        const shockable = ["VF", "PVT", "VT"].includes(p.rhythm) && !recentAEDShock(p);
        a.message = shockable ? "SHOCK ADVISED" : "NO SHOCK ADVISED";
        sound(sim, shockable ? "aed_shockadvised" : "aed_noshockadvised");
        sim.schedule(shockable ? 1.7 : 2, "aedAdvice", { shockable, epoch });
    },
    aedMotionTick(sim, { lastMotion, epoch }) {
        const { p } = sim;
        const a = aedState(p);
        if (epoch !== a.epoch) return;
        const last = p.cpr || p.bvm ? p.t : lastMotion;
        if (!a.pads || !a.busy) { sound(sim, "aed_3beep"); a.message = ""; return; }
        if (last + 2 < p.t) { sim.schedule(1.5, "aedRetry", { epoch }); return; }
        sim.schedule(1, "aedMotionTick", { lastMotion: last, epoch });
    },
    aedRetry(sim, { epoch }) { if (epoch === aedState(sim.p).epoch) analyze(sim, true); },
    aedSay(sim, { name }) { sound(sim, name); },
    aedAdvice(sim, { shockable, epoch }) {
        const a = aedState(sim.p);
        if (epoch !== a.epoch) return;
        if (shockable) { beginCharge(sim, false); return; }
        a.inUse = false;
        trackCPR(sim);
        sound(sim, "aed_startcpr");
        a.message = "START CPR";
        sim.schedule(2, "aedNotBusy", { epoch });
    },
    aedCharged(sim, { manual, epoch }) {
        const a = aedState(sim.p);
        if (epoch !== a.epoch || !a.pads) return;
        if (manual) { aedTimers.aedChargeReady(sim, { epoch }); return; }
        sound(sim, "aed_standclear_pushtoshock");
        a.message = "STAND CLEAR - PUSH TO SHOCK";
        sim.schedule(2.5, "aedChargeReady", { epoch });
    },
    aedChargeReady(sim, { epoch }) {
        const a = aedState(sim.p);
        if (epoch !== a.epoch || !a.pads) return;
        a.charged = true;
        a.chargedAt = sim.p.t;
        a.message = "PUSH TO SHOCK";
        sim.schedule(30, "aedChargeTimeout", { epoch, chargedAt: sim.p.t });
    },
    aedChargeTimeout(sim, { epoch, chargedAt }) {
        const a = aedState(sim.p);
        if (epoch !== a.epoch || !a.charged || (a.chargedAt && a.chargedAt !== chargedAt)) return;
        a.charged = false; a.inUse = false; a.message = "";
        sound(sim, "aed_3beep");
    },
    aedTrackCPR(sim, { epoch }) { if (epoch === aedState(sim.p).epoch) { trackCPR(sim); aedState(sim.p).message = "START CPR"; } },
    aedNotBusy(sim, { epoch }) { if (epoch === aedState(sim.p).epoch) aedState(sim.p).busy = false; },
    aedRecheckPrompt(sim, { epoch }) { if (epoch === aedState(sim.p).epoch && aedState(sim.p).pads) sound(sim, "aed_checkpulse_nopulsepushanalyze"); },
    aedBPDone(sim, { epoch }) {
        const { p } = sim;
        const a = aedState(p);
        a.cuffBusy = false;
        if (epoch !== a.epoch || a.cuff === -1) return;
        let s = 0, d = 0;
        if (!p.tourniquets[a.cuff] && p.bp[1] >= 80 && hasPulse(p, true)) { s = p.bp[1]; d = p.bp[0]; }
        a.display.bp = [s, d];
    },
};

// ------------------------------------------------------------------ monitor values (handleAED per-frame, once per second here)
/** getEKGHeartRate: what the pads show. PEA shows an organised rate generated from the patient's state (no pulse). */
export function ekgHeartRate(sim) {
    const { p, rng } = sim;
    const a = aedState(p);
    if (p.cpr) return p.hr;
    if (recentAEDShock(p) || !p.alive) return 0;
    switch (p.rhythm) {
        case "Asystole": a.ekgHR = 0; return 0;
        case "VF": return Math.round(rng.tri(150, 170, 200));
        case "PVT": return Math.round(rng.tri(200, 220, 240));
        case "PEA": return peaRate(sim);
        default: a.ekgHR = p.hr; return p.hr;
    }
}
function peaRate(sim) {
    const { p } = sim;
    const a = aedState(p);
    const desired = p.targets.hr;
    let hr = a.ekgHR ?? desired;
    const bv = p.bloodVolume;
    let target = lin(6, 5.1, bv, desired, desired + 35, false);
    if (bv <= 5.1 && bv > 4.2) target = lin(5.1, 4.2, bv, desired, desired + 35, false);
    if (bv <= 4.2) target = lin(4.2, 3.6, bv, desired + 35, desired + 120, false);
    const pain = painPerceived(p);
    if (pain > 0.2) target = Math.max(target, desired + 40 * pain);
    if (p.woundBleeding > 0) target -= 10 * p.woundBleeding * (pain + 0.1);
    if (bv > 3.9) target = Math.min(target, p.targets.maxHr);
    const oxy = Math.min(p.targets.maxHr, target + (p.targets.spo2 - p.spo2) * 2);
    target = Math.max(target, oxy);
    if (bv < 3.4) target += 266 * (bv - 3.4);
    const change = Math.sign(target - hr) * Math.round(Math.abs(target - hr)) / 2;
    hr = change < 0 ? Math.max(hr + change, target) : Math.min(hr + change, target);
    hr = Math.max(30, hr);
    a.ekgHR = hr;
    return hr;
}

/** breathing/getEtCO2 */
export function etco2(sim) {
    const { p } = sim;
    const sinceROSC = p.t - p.roscTime;
    const aw = Math.min(1, airwayState(p) / 0.95), br = Math.min(1, breathingState(p) / 0.85);
    const bvEff = Math.min(1, effectiveBloodVolume(p) / 5.9);
    if (sinceROSC < 45) return lin(0, 30, sinceROSC, 50 * bvEff, 30 * bvEff);
    const desiredRR = p.targets.rr;
    let a, b, v, c, d;
    if (p.hr < 20 || p.cardiacArrest || !p.alive) {
        if (!p.cpr) return 0;
        [a, b, v, c, d] = [100, 120, p.hr, 10, 20];
    } else {
        v = p.rr;
        if (v < desiredRR) [a, b, c, d] = [1, desiredRR, ...(p.unconscious ? [35, 30] : [45, 35])];
        else [a, b, c, d] = [desiredRR, 50, ...(p.unconscious ? [30, 15] : [35, 20])];
    }
    return lin(a, b, v * Math.min(aw, br), c * bvEff, d * bvEff);
}

/** handleAED display refresh: pads HR every 5.25 s, SpO2 every 3 s, RR/EtCO2 every 4 s. Call once per second. */
export function updateAED(sim) {
    const { p } = sim;
    const a = aedState(p);
    if (!hasAED(p)) return;
    const ekg = a.pads ? ekgHeartRate(sim) : 0;
    a.liveEKG = ekg;
    if (a.pads && a.sync.pads + 5.25 < p.t) { a.sync.pads = p.t; a.display.hr = Math.round(ekg); }
    if (a.po !== -1 && a.sync.po + 3 < p.t) {
        a.sync.po = p.t;
        if (!p.tourniquets[a.po] && p.bp[1] >= 80 && hasPulse(p, true)) {
            a.display.spo2 = Math.round(readSpO2(sim));
            if (!a.pads) a.display.hr = Math.round(p.hr);
        } else {
            a.display.spo2 = 0;
            if (!a.pads) a.display.hr = 0;
        }
    }
    if (a.capno && a.sync.capno + 4 < p.t) {
        a.sync.capno = p.t;
        a.display.rr = Math.round(p.rr);
        a.display.co2 = Math.round(etco2(sim));
    }
    if (a.tracking && a.trackUntil < p.t) { a.tracking = false; if (a.message === "START CPR") a.message = ""; }
}
