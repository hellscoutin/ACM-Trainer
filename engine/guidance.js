// Guidance rules (docs/TRAINER-design.md step 8; ACM Training design 3.3 "Patient Monitor").
// Rules live in rules/guidance.json and are shared with the future ATAK patient monitor (SQF). This file is the
// JavaScript interpreter: it builds the knowledge view for a depth, evaluates the rules and fills in the text.
// The view's fields are the contract both interpreters implement; rules/README.md lists them with their ACM sources.
//   Depth 1 Basic:        what the menu shows without examinations, plus device readings (pulse oximeter, AED monitor)
//   Depth 2 Intermediate: plus findings of examinations already done (values as they were at the time of the exam)
//   Depth 3 Advanced:     plus the true patient state
import { BODY_PARTS, PART_INDEX } from "./util.js";
import { PART_NAMES, bleedSeverity } from "./injuryList.js";
import { feelPulse, capillaryRefill } from "./exams.js";
import { checkBreathing, inspectChest } from "./breathing.js";
import { airwayState } from "./oxygen.js";
import { aedState } from "./aed.js";

export const DEPTHS = { 0: "Off", 1: "Basic", 2: "Intermediate", 3: "Advanced" };
export const LIMBS = ["leftarm", "rightarm", "leftleg", "rightleg"];
const NEVER = 1e9;
const HEAVY_RATE = 0.08; // L/min from one part: about one large bleeding wound (what the wound sizes in the injury list suggest)

// ------------------------------------------------------------------ examination findings
/** Exam actions and what each reveals. Called by the recorder for every completed menu action. */
export function noteFinding(sim, id, part) {
    const p = sim.p;
    const f = (p.findings ??= { t: {} });
    const seen = (key) => { f.t[key] = p.t; };
    switch (id) {
        case "checkairway": {
            seen("checkairway");
            const managed = p.recoveryPosition || p.headTilt || p.airwayOral === "SGA";
            f.obstructed = p.obstructionVomit + p.obstructionBlood > 0;
            f.collapse = !managed && p.airwayCollapse > 0;
            break;
        }
        case "checkbreathing": {
            seen("checkbreathing");
            const log = checkBreathing(sim).log;
            f.breathing = log;
            f.noBreathing = log === "None";
            f.shallow = /shallow/i.test(log);
            break;
        }
        case "inspectchest": {
            seen("inspectchest");
            const log = inspectChest(sim).log;
            f.uneven = /uneven/i.test(log);
            f.deviation = /deviation/i.test(log);
            f.bruising = /bruising/i.test(log);
            break;
        }
        case "usestethoscope":
            seen("usestethoscope");
            f.breathSoundsAbnormal = p.ptx > 0 || p.tensionPtx || p.htxFluid > 0.5;
            f.heartSoundsAbsent = !p.alive || p.cardiacArrest;
            break;
        case "checkpulse": {
            seen("checkpulse");
            const r = feelPulse(sim, part);
            if (part === "head") f.carotid = Math.round(r.rate); else f.limbPulse = Math.round(r.rate);
            break;
        }
        case "checkbloodpressure": {
            seen("checkcrt");
            const v = capillaryRefill(sim, part).log.match(/: (\S+)s/)?.[1] || "";
            f.crt = v;
            f.crtSlow = v === ">4" || v === "~3";
            break;
        }
        case "measurebloodpressure": case "measurebloodpressurestethoscope": case "aed_measurebp":
            seen("bp");
            f.sys = p.alive ? Math.round(p.bp[1]) : 0;
            break;
        case "checkresponse": seen("checkresponse"); f.responsive = p.alive && !p.unconscious; break;
        case "checkdogtags": seen("checkdogtags"); f.bloodTypeKnown = true; break;
        case "aed_analyzerhythm": seen("aedanalyze"); f.shockable = ["VF", "PVT"].includes(p.rhythm); break;
        case "inspectforfracture": seen("fx_" + part); f["fx_" + part] = p.fractureState[PART_INDEX[part]] || 0; break;
        default: break;
    }
}

// ------------------------------------------------------------------ knowledge view
function partBleed(p, part) {
    const i = PART_INDEX[part];
    if (p.tourniquets[i]) return { rate: 0, large: false, open: p.openWounds[part].some((w) => w.count > 0) };
    let rate = 0, large = false, open = false;
    for (const w of p.openWounds[part]) if (w.count > 0) { open = true; rate += w.count * w.bleeding; if (w.size === 2 && w.bleeding > 0) large = true; }
    return { rate, large, open };
}

/** The flat object rules test. ctx: { level } (trainee's training level 0/1/2). */
export function knowledgeView(sim, depth, ctx = {}) {
    const p = sim.p, f = p.findings || { t: {} };
    const since = (k) => (f.t[k] === undefined ? NEVER : p.t - f.t[k]);
    const aed = aedState(p);
    const ox = (p.pulseOxDisplay || []).find((d, k) => p.pulseOx[k] && d[0] > 0);
    const v = {
        depth, level: ctx.level ?? 0, t: p.t, alive: p.alive, unconscious: !!p.unconscious,
        cpr: !!p.cpr, bvm: !!p.bvm, headTilt: !!p.headTilt, recoveryPosition: !!p.recoveryPosition,
        airwayAdjunct: !!(p.airwayOral || p.airwayNasal), sga: p.airwayOral === "SGA", chestSeal: !!p.chestSeal,
        airwayManaged: !!(p.headTilt || p.recoveryPosition || p.airwayOral || p.airwayNasal),
        pulseOx: p.pulseOx.some(Boolean) || aed.po !== -1, aedPads: !!aed.pads,
        hasAccess: p.ivAccess.some((s) => s.some(Boolean)) || p.ioAccess.some(Boolean),
        bagsRunning: p.ivBags.length, bloodBags: p.ivBags.filter((b) => b.type === "Blood").length,
        bleedingAny: p.woundBleeding > 0, bleedSeverity: p.woundBleeding > 0 ? bleedSeverity(sim) : -1, bloodLoss: p.hemorrhage || 0,
        inPain: p.alive && !p.unconscious && p.pain - p.painSuppress > 0.1, severePain: p.alive && !p.unconscious && p.pain - p.painSuppress > 0.5,
        // any torso wound the injury list shows (open, bandaged, clotted, wrapped or stitched)
        torsoWound: ["openWounds", "bandagedWounds", "clottedWounds", "wrappedWounds", "stitchedWounds"].some((k) => (p[k]?.body || []).some((w) => w.count > 0)),
        bloodTypeKnown: !!f.bloodTypeKnown,
        // device readings (what a pulse oximeter or the AED monitor displays); null when nothing measures them
        spo2: ox ? ox[0] : aed.po !== -1 && aed.display.spo2 > 0 ? aed.display.spo2 : null,
        hr: aed.pads && aed.display.hr > 0 ? aed.display.hr : ox ? ox[1] : null,
        sys: aed.cuff !== -1 && aed.display.bp[1] > 0 ? aed.display.bp[1] : depth >= 1 && f.sys !== undefined && since("bp") < 300 ? f.sys : null,
    };
    for (const k of ["checkairway", "checkbreathing", "inspectchest", "usestethoscope", "checkpulse", "checkcrt", "bp", "checkresponse", "aedanalyze"]) v["since_" + k] = since(k);
    v.since_chestexam = Math.min(v.since_checkbreathing, v.since_inspectchest, v.since_usestethoscope);
    for (const part of BODY_PARTS) {
        const i = PART_INDEX[part], b = partBleed(p, part);
        v[`bleeding_${part}`] = b.rate > 0;
        v[`heavy_${part}`] = b.rate >= HEAVY_RATE;
        v[`openWounds_${part}`] = b.open;
        v[`tourniquet_${part}`] = !!p.tourniquets[i];
        v[`fractured_${part}`] = p.fractures[i] === 1;
        v[`splinted_${part}`] = p.fractures[i] === -1;
        v[`realigned_${part}`] = !!p.fracturePrepared?.[i];
    }
    if (depth >= 2) {
        Object.assign(v, {
            f_obstructed: !!f.obstructed && v.since_checkairway < 300, f_collapse: !!f.collapse && v.since_checkairway < 300,
            f_breathing: f.breathing ?? null, f_noBreathing: !!f.noBreathing && v.since_checkbreathing < 120, f_shallow: !!f.shallow && v.since_checkbreathing < 300,
            f_uneven: !!(f.uneven || f.breathSoundsAbnormal) && v.since_chestexam < 600, f_deviation: !!f.deviation && v.since_inspectchest < 300,
            f_bruising: !!f.bruising && v.since_inspectchest < 600,
            f_carotid: f.carotid ?? null, f_limbPulse: f.limbPulse ?? null, f_crt: f.crt ?? null, f_crtSlow: !!f.crtSlow && v.since_checkcrt < 300,
            f_sys: f.sys ?? null, f_shockable: !!f.shockable && v.since_aedanalyze < 120, f_heartSoundsAbsent: !!f.heartSoundsAbsent && v.since_usestethoscope < 120,
        });
        for (const part of LIMBS) v[`f_fx_${part}`] = f["fx_" + part] ?? 0;
    }
    if (depth >= 3) {
        Object.assign(v, {
            bloodVolume: p.bloodVolume, internalBleeding: p.internalBleeding, ibRate: Math.round(p.internalBleeding * 1000), woundBleeding: p.woundBleeding,
            ptx: p.ptx, tensionPtx: !!p.tensionPtx, htxFluid: p.htxFluid, chestInjury: !!p.chestInjury,
            rhythm: p.rhythm, cardiacArrest: !!p.cardiacArrest, shockable: ["VF", "PVT"].includes(p.rhythm),
            airwayBlocked: p.alive && p.unconscious && airwayState(p) === 0, obstructed: p.obstructionVomit + p.obstructionBlood > 0,
            spo2True: Math.round(p.spo2), hrTrue: Math.round(p.hr), sysTrue: Math.round(p.bp[1]), bloodType: p.bloodType,
            txa: sim.medCount("TXA_IV"), epinephrine: sim.medCount("Epinephrine_IV"), hemolytic: (p.reactionSeverity || 0) > 0,
            painLevel: Math.round(Math.max(0, p.pain - p.painSuppress) * 100),
        });
    }
    return v;
}

// ------------------------------------------------------------------ evaluation
const OPS = { "==": (a, b) => a === b, "!=": (a, b) => a !== b, "<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b };
/** Same grammar as rubric predicates; a field that is missing or null fails every comparison except "!=" (SQF: isNil). */
export function testRule(pred, v) {
    if (!pred) return true;
    if (pred.all) return pred.all.every((x) => testRule(x, v));
    if (pred.any) return pred.any.some((x) => testRule(x, v));
    if (pred.not) return !testRule(pred.not, v);
    const fn = OPS[pred.op || "=="];
    if (!fn) throw new Error("Unknown operator " + pred.op);
    const a = v[pred.field];
    if (a === undefined || a === null) return pred.op === "!=" && pred.value !== null;
    return fn(a, pred.value);
}
const subst = (pred, part) => JSON.parse(JSON.stringify(pred).replaceAll("{part}", part));
const DECIMALS = { bloodVolume: 2, htxFluid: 1 };
function fill(text, v, part) {
    return text.replace(/\{(\w+)\}/g, (m, k) => {
        if (k === "part") return PART_NAMES[part].toLowerCase();
        if (k === "Part") return PART_NAMES[part];
        const x = v[k];
        if (typeof x === "number") return x.toFixed(DECIMALS[k] ?? 0);
        return x ?? m;
    });
}
const EACH = { parts: BODY_PARTS, limbs: LIMBS, core: ["head", "body"] };

/**
 * Matching recommendations, most urgent first: [{ id, priority, depth, text, part, guide }].
 * A dead casualty gets only the rules marked `dead: true`.
 */
export function evaluateGuidance(rules, sim, { depth, level = 0 }) {
    if (!depth) return [];
    const v = knowledgeView(sim, depth, { level });
    const out = [];
    rules.rules.forEach((r, order) => {
        if (r.depth > depth || (!!r.dead !== !v.alive)) return;
        if (r.minLevel !== undefined && level < r.minLevel) return;
        if (r.maxLevel !== undefined && level > r.maxLevel) return;
        for (const part of r.each ? EACH[r.each] : [null]) {
            const when = part ? subst(r.when, part) : r.when;
            if (testRule(when, v)) out.push({ id: part ? `${r.id}:${part}` : r.id, rule: r.id, priority: r.priority, order, depth: r.depth, part, text: fill(r.text, v, part), guide: r.guide });
        }
    });
    // a rule may hide lower-priority rules it supersedes (e.g. the arrest procedure hides "feel a pulse")
    const hidden = new Set(out.flatMap((o) => rules.rules.find((r) => r.id === o.rule).supersedes || []));
    return out.filter((o) => !hidden.has(o.rule)).sort((a, b) => a.priority - b.priority || a.order - b.order);
}
