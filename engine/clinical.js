// What is really wrong with the patient: the full clinical state (instructor "full patient state" view) and, after or
// during a run, the list of problems the patient had with when they started, how bad they got, what was done about
// them and whether they were resolved (debrief, replay and the instructor dashboard). Firestore-safe (no nested arrays).
import { BODY_PARTS, PART_INDEX } from "./util.js";
import { medicationEffect, ROUTE } from "./pharmacology.js";
import { airwayState, breathingState } from "./oxygen.js";
import { PART_NAMES } from "./injuryList.js";

const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
const ROUTE_NAME = { [ROUTE.IM]: "IM", [ROUTE.IV]: "IV", [ROUTE.PO]: "oral", [ROUTE.INHALE]: "inhaled" };
const FRACTURE_SEV = ["", "mild", "severe", "complex"];

/** Drugs in the system now, with their timing and what they are doing at this moment. */
export function medicationsNow(sim) {
    const p = sim.p;
    return p.meds.map((m) => {
        const t = p.t - m.added;
        const e = Math.max(0, medicationEffect(m.route, t, m.onset, m.total, m.plateau));
        const phase = t < m.onset ? "taking effect" : t < m.onset + m.plateau ? "full effect" : t < m.total ? "wearing off" : "cleared";
        const eff = {};
        for (const [k, label] of [["hr", "heart rate"], ["pain", "pain relief"], ["rr", "respiration"], ["co2", "CO2 sensitivity"], ["breathing", "breathing"], ["flow", "blood flow"]]) {
            const v = k === "pain" ? Math.round(m[k] * e * 100) : r2(m[k] * e); // pain relief in %
            if (v) eff[k === "pain" ? "pain relief %" : label] = v;
        }
        return { name: m.name, route: ROUTE_NAME[m.route] ?? String(m.route), part: BODY_PARTS[m.part] ?? null, dose: m.dose ?? null, since: t, total: Math.round(m.total),
            remaining: Math.max(0, Math.round(m.total - t)), effect: Math.round(e * 100), phase, effects: eff };
    }).filter((m) => m.phase !== "cleared");
}

/** The full clinical state, grouped like the guide (MARCH). */
export function clinicalState(sim) {
    const p = sim.p;
    const consciousness = !p.alive ? "Dead" : p.cardiacArrest ? "Cardiac arrest" : p.unconscious ? (p.knockOut ? "Unconscious (knocked out)" : "Unconscious") : "Conscious";
    const bleedingParts = BODY_PARTS.map((part, i) => {
        const rate = p.tourniquets[i] ? 0 : p.openWounds[part].reduce((a, w) => a + (w.count > 0 ? w.count * w.bleeding : 0), 0);
        return rate > 0 ? { part, ml: Math.round(rate * 1000) } : null;
    }).filter(Boolean);
    const internalParts = BODY_PARTS.map((part, i) => {
        const rate = p.tourniquets[i] ? 0 : p.internalWounds[part].reduce((a, w) => a + w.count * w.bleeding, 0); // a tourniquet stops a limb's internal bleeding
        return rate > 0 ? { part, ml: Math.round(rate * 1000) } : null;
    }).filter(Boolean);
    const c = {
        consciousness, rhythm: p.rhythm, cardiacArrest: !!p.cardiacArrest, reversibleArrest: !!p.reversibleActive,
        airway: {
            state: Math.round(airwayState(p) * 100), reflex: !!p.airwayReflex, collapse: p.airwayCollapse || 0,
            vomit: p.obstructionVomit || 0, blood: p.obstructionBlood || 0,
            adjuncts: [p.airwayNasal, p.airwayOral === "SGA" ? "i-gel" : p.airwayOral, p.surgicalAirway ? "surgical airway" : ""].filter(Boolean).join(", "),
            positioning: p.recoveryPosition ? "recovery position" : p.headTilt ? "head tilt-chin lift" : "",
        },
        breathing: {
            rr: Math.round(p.rr), spo2: Math.round(p.spo2), state: Math.round(breathingState(p) * 100),
            ptx: p.ptx, tension: !!p.tensionPtx, htxLevel: p.htxState || 0, htxFluid: r2(p.htxFluid || 0), chestInjury: !!p.chestInjury, chestSeal: !!p.chestSeal,
            thoracostomy: p.thoracostomy >= 1 ? (p.thoracostomy === 2 ? "chest tube" : "open") : "", bvm: !!p.bvm,
        },
        circulation: {
            hr: Math.round(p.hr), sys: Math.round(p.bp[1]), dia: Math.round(p.bp[0]), bloodVolume: r2(p.bloodVolume),
            blood: r2(p.blood), plasma: r2(p.plasma), saline: r2(p.saline), platelets: r2(p.platelets), overload: r2(p.overload), transfused: r2(p.transfused), calcium: r2(p.calcium),
            externalBleeding: Math.round(p.woundBleeding * 1000), internalBleeding: Math.round(p.internalBleeding * 1000), bleedingParts, internalParts,
            hemolytic: r1(p.reactionSeverity || 0),
            bags: p.ivBags.map((b) => ({ type: b.type, bloodType: b.bloodType || null, remaining: Math.round(b.remaining), part: b.part, iv: b.iv })),
            tourniquets: BODY_PARTS.filter((x, i) => p.tourniquets[i]).map((part) => ({ part, minutes: p.tourniquetTime?.[PART_INDEX[part]] >= 0 ? Math.round((p.t - p.tourniquetTime[PART_INDEX[part]]) / 60) : null })),
        },
        disability: {
            pain: Math.round(Math.max(0, p.pain - p.painSuppress) * 100), painRaw: Math.round(p.pain * 100), painSuppressed: Math.round(p.painSuppress * 100),
            fractures: BODY_PARTS.map((part, i) => (p.fractures?.[i] ? { part, state: p.fractures[i] === -1 ? "splinted" : "fractured", severity: FRACTURE_SEV[p.fractureState?.[i] || 0] || "" } : null)).filter(Boolean),
        },
        meds: medicationsNow(sim),
    };
    if (p.cbrn) {
        const b = p.cbrn.buildup;
        c.cbrn = { agent: p.cbrn.agent, inCloud: !!p.cbrn.inCloud, sarin: r1(b.Sarin), lewisite: r1(b.Lewisite), chlorine: r1(b.Chlorine), cs: r1(b.CS),
            spasm: !!p.cbrn.spasm, inflammation: p.cbrn.inflammation, lungDamage: p.cbrn.lungDamage, capillary: Math.round(p.cbrn.capillary), mask: !!p.cbrn.ppe.mask, filter: p.cbrn.ppe.filter };
    }
    return c;
}

// ------------------------------------------------------------------ problems over a run
const BLEED_ACTIONS = /^(fielddressing|packingbandage|elasticbandage|quikclot|pressurebandage|emergencytraumadressing|applytourniquet|elasticwrap.*|surgicalkit|stitch.*)$/;
// A tourniquet stops a limb's internal bleeding, so it counts as a treatment for internal bleeding.
const DEFS = [
    { id: "tension", label: "Tension pneumothorax", on: (s) => s.tensionPtx, actions: /^(performncd|performthoracostomy.*)$/, worst: () => "" },
    { id: "ptx", label: "Pneumothorax", on: (s) => s.ptx > 0 || s.tensionPtx, actions: /^(applychestseal|performncd|performthoracostomy.*|insertchesttube)$/, worst: (h) => `level ${Math.max(...h.map((s) => s.ptx))}` },
    { id: "htx", label: "Hemothorax (blood in the chest)", on: (s) => s.htxState > 0 || s.htxFluid > 0.3, actions: /^(txa_\d+_iv|performthoracostomy.*|insertchesttube|drainfluid_.*)$/, worst: (h) => `${Math.max(...h.map((s) => s.htxFluid)).toFixed(2)} L` },
    { id: "ib", label: "Internal bleeding", on: (s) => s.internalBleeding > 0, actions: /^(txa_\d+_iv|applytourniquet)$/, bags: true, worst: (h) => `${Math.round(Math.max(...h.map((s) => s.internalBleeding)) * 1000)} ml/min` },
    { id: "obstructed", label: "Airway obstructed (vomit or blood)", on: (s) => s.obstructed, actions: /^(usesuctionbag|useaccuvac|headturn|recoveryposition)$/, worst: () => "" },
    { id: "airway", label: "Airway closed", on: (s) => s.airwayBlocked, actions: /^(beginheadtiltchinlift|insertopa|insertnpa|insertigel|recoveryposition|establishsurgicalairway|surgicalairway_established)$/, worst: () => "" },
    { id: "arrest", label: "Cardiac arrest", on: (s) => s.cardiacArrest, actions: /^(cpr|aed_.*|epinephrine_\d+_iv|amiodarone_\d+_iv|lidocaine_\d+_iv)$/, worst: (h) => [...new Set(h.map((s) => s.rhythm))].join(" → ") },
    { id: "hypoxia", label: "Low oxygen (SpO2 under 85 %)", on: (s) => s.alive && s.spo2 < 85, actions: /^(usebvm|beginheadtiltchinlift|insertopa|insertnpa|insertigel|recoveryposition|applychestseal|performncd)$/, worst: (h) => `${Math.round(Math.min(...h.map((s) => s.spo2)))} %` },
    { id: "bv", label: "Blood volume below 5.1 L (cannot wake)", on: (s) => s.alive && s.bloodVolume < 5.1, bags: true, actions: /^$/, worst: (h) => `${Math.min(...h.map((s) => s.bloodVolume)).toFixed(2)} L` },
    { id: "unconscious", label: "Unconscious", on: (s) => s.alive && s.unconscious && !s.cardiacArrest, info: true, worst: () => "" },
    { id: "pain", label: "Severe pain", on: (s) => s.alive && !s.unconscious && s.pain > 0.5, actions: /^(paracetamol|morphine|penthrox|fentanyllozenge|(morphine|fentanyl|ketamine)_\d+_(iv|im))$/, worst: (h) => `${Math.round(Math.max(...h.map((s) => s.pain)) * 100)} %` },
    { id: "hemolytic", label: "Hemolytic reaction (incompatible blood)", on: (s) => s.hemolytic, removes: true, actions: /^$/, worst: () => "" },
    { id: "spasm", label: "Sarin airway spasm", on: (s) => s.spasm, actions: /^(atna_autoinjector|atropine_\d+_(iv|im)|establishsurgicalairway|surgicalairway_established)$/, worst: () => "" },
    { id: "sarin", label: "Sarin exposure", on: (s) => s.sarin > 0, actions: /^(atna_autoinjector|atropine_\d+_(iv|im)|midazolam_autoinjector)$/, worst: (h) => `buildup ${Math.round(Math.max(...h.map((s) => s.sarin)))}` },
    { id: "lewisite", label: "Lewisite exposure", on: (s) => s.lewisite > 0, actions: /^(dimercaprol_\d+_im|dragoutofcloud|putongasmask|washeyes)$/, worst: (h) => `buildup ${Math.round(Math.max(...h.map((s) => s.lewisite)))}` },
    { id: "cloud", label: "In the chemical cloud", on: (s) => s.inCloud, actions: /^(dragoutofcloud|putongasmask)$/, worst: () => "" },
];
for (const part of BODY_PARTS) {
    DEFS.push({ id: `bleed_${part}`, label: `External bleeding: ${PART_NAMES[part]}`, part, on: (s) => s[`bleeding_${part}`] > 0, actions: BLEED_ACTIONS, worst: (h) => `${Math.round(Math.max(...h.map((s) => s[`bleeding_${part}`])) * 1000)} ml/min` });
    if (part !== "head" && part !== "body") DEFS.push({ id: `fracture_${part}`, label: `Fracture: ${PART_NAMES[part]}`, part, on: (s) => s[`fracture_${part}`] === 1, actions: /^(fracturerealignment|applysamsplint)$/, worst: () => "" });
}

/** Spans where a condition held (gaps under 5 s are bridged). */
function spans(history, on) {
    const out = [];
    let cur = null;
    for (const s of history) {
        if (on(s)) { if (!cur) cur = { start: s.t, end: null, last: s.t }; else cur.last = s.t; }
        else if (cur && s.t - cur.last > 5) { cur.end = cur.last; out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return out;
}

/**
 * problems({ history, log, events }) -> [{ id, label, part, start, end (null = still present), worst, treatments: [{t, id, part}],
 * status: "resolved" | "treated" | "not treated" | "info" }]. Treatments count from 30 s before the problem started (a seal
 * put on early still counts) to its end; for a body part, only actions on that part.
 */
export function analyzeProblems({ history, log = [], events = [] }) {
    if (!history?.length) return [];
    const lastT = history.at(-1).t;
    const death = history.find((s) => !s.alive)?.t ?? null; // a condition that "ends" at death was not resolved
    const acts = log.filter((e) => e.ok && !/^(inject_|set_)/.test(e.id));
    const out = [];
    for (const d of DEFS) {
        for (const sp of spans(history, d.on)) {
            const end = sp.end !== null && death !== null && sp.end >= death - 2 ? null : sp.end;
            const from = sp.start - 30, to = (end ?? lastT) + 2; // an action is logged when it finishes, just after the condition ends
            const window = history.filter((s) => s.t >= sp.start && s.t <= (end ?? lastT));
            let treatments = d.info ? [] : acts.filter((e) => e.t >= from && e.t <= to && d.actions?.test(e.id) && (!d.part || e.part === d.part)).map((e) => ({ t: e.t, id: e.id, part: e.part || null }));
            if (d.bags) treatments = treatments.concat(events.filter((e) => e.event === "bagAdded" && e.t >= from && e.t <= to && (e.type !== "Blood" || e.compatible)).map((e) => ({ t: e.t, id: `bag:${e.type}${e.bloodType ? " " + e.bloodType : ""}`, part: e.part || null })));
            if (d.removes) treatments = treatments.concat(events.filter((e) => e.event === "bagRemoved" && !e.compatible && e.t >= from && e.t <= to).map((e) => ({ t: e.t, id: "bag:removed incompatible", part: null })));
            treatments.sort((a, b) => a.t - b.t);
            const status = d.info ? "info" : end !== null ? (treatments.length ? "resolved" : "resolved on its own") : treatments.length ? "treated" : "not treated";
            out.push({ id: d.id, label: d.label, part: d.part || null, start: sp.start, end, worst: d.worst(window.length ? window : history), treatments, status });
        }
    }
    return out.sort((a, b) => a.start - b.start || a.label.localeCompare(b.label));
}
