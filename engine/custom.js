// Step 7 helpers shared by the browser and the tests: training computer (random patient) scenarios, the generic rubric
// used for random and custom scenarios, scenario validation for the editor, the item catalogue, replay frames and CSV.
import { BODY_PARTS } from "./util.js";
import { DAMAGE_TYPES, CAUSES, SEVERITIES, CAUSES_FOR } from "./damage.js";
import { itemName } from "./menu.js";
import { injuryList, bodyPartColors } from "./injuryList.js";
import { bagItemClass } from "./circulation.js";
import { SYRINGE_DRUGS, SYRINGE_SIZES, vialItem } from "./syringes.js";

export { CAUSES, SEVERITIES, CAUSES_FOR };
export const ROLES = ["anyone", "medic", "doctor"];
export const TRACKS = ["combat-lifesaver", "combat-medic", "advanced-medic"];
export const BLOOD_TYPES = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];
export const MECHANISMS = Object.keys(DAMAGE_TYPES);
export const MECHANISM_NAMES = {
    bullet: "Gunshot", grenade: "Grenade fragments", explosive: "Explosion", shell: "Artillery shell", vehiclecrash: "Vehicle crash (random part)",
    collision: "Collision", falling: "Fall", backblast: "Backblast", stab: "Stab", punch: "Punch",
};

/** Kit per role: a combat lifesaver's aid kit, a medic's bag, and the advanced bag on top. */
export const ROLE_LOADOUT = {
    anyone: { ACE_tourniquet: 4, ACM_PressureBandage: 10, ACM_EmergencyTraumaDressing: 2, ACM_ChestSeal: 2, ACM_SAMSplint: 2, ACM_NPA: 1, ACM_Paracetamol: 2 },
};
ROLE_LOADOUT.medic = {
    ...ROLE_LOADOUT.anyone, ACM_ElasticWrap: 4, ACM_NCDKit: 2, ACM_OPA: 1, ACM_IGel: 1, ACM_BVM: 1, ACM_SuctionBag: 1,
    ACM_IV_16g: 3, ACM_IO_EZ: 1, ACM_Syringe_10: 3, ACM_Syringe_5: 2, ACM_Vial_TXA: 2, ACM_Vial_Morphine: 1, ACM_Vial_Lidocaine: 2, ACM_Vial_Epinephrine: 2,
    ACM_BloodBag_ON_500: 4, ACE_salineIV: 2, ACM_PulseOximeter: 1, ACM_Stethoscope: 1, ACM_PressureCuff: 1,
};
ROLE_LOADOUT.doctor = { ...ROLE_LOADOUT.medic, ACM_IV_14g: 2, ACM_ThoracostomyKit: 1, ACM_ChestTubeKit: 1, ACM_CricKit: 1, ACE_surgicalKit: 1, ACM_AED: 1, ACM_Vial_Amiodarone: 1 };

const P = (field, op, value) => ({ field, op, value });
const ALIVE = P("alive", "==", true);
/** Rubric for random and custom scenarios: the outcomes every casualty needs, whatever the injuries. */
export const GENERIC_RUBRIC = {
    generic: true, passMark: 0.7, checks: [
        { id: "bleed", text: "All external bleeding stopped within 3 minutes", type: "state-within", state: P("woundBleeding", "==", 0), within: 180, weight: 3,
            why: "Check every body part and stop each bleed: tourniquet for heavy limb bleeding, dressings for the rest.", guide: "External bleeding" },
        { id: "airway", text: "Airway never blocked for more than 60 s", type: "state-duration-max", state: P("airwayBlocked", "==", true), max: 60, weight: 2,
            why: "An unconscious casualty on his back loses the airway. Head tilt-chin lift, an airway adjunct or the recovery position keeps it open.", guide: "Airway" },
        { id: "spo2", text: "SpO2 under 80 % for no more than 60 s", type: "state-duration-max", state: { all: [ALIVE, P("spo2", "<", 80)] }, max: 60, weight: 2,
            why: "Low oxygen leads to unconsciousness and hypoxic arrest. Look for airway, chest and blood loss problems.", guide: "Ventilation and oxygen" },
        { id: "bv", text: "Blood volume at least 5.1 L at the end", type: "end-state", state: P("bloodVolume", ">=", 5.1), weight: 1,
            why: "Below 5.1 L the casualty cannot wake up. Replace lost volume (blood first).", guide: "Fluids and blood" },
        { id: "alive", text: "Casualty alive at the end", type: "end-state", state: ALIVE, weight: 3, critical: true, why: "The casualty must survive.", guide: "The patient model" },
    ],
};

const ROLE_TRACK = { anyone: "combat-lifesaver", medic: "combat-medic", doctor: "advanced-medic" };
/** A training-computer scenario: ACM generatePatient with the chosen severity and cause (0 = random). */
export function randomScenario({ severity = 0, cause = 0, role = "medic", seed = 1, timeLimit = 900 } = {}) {
    severity = Number(severity) || 0; cause = Number(cause) || 0;
    if (cause && severity && !CAUSES_FOR[severity].includes(cause)) cause = 0; // the training computer offers only these causes per severity
    const sev = severity ? SEVERITIES[severity] : "Random severity", why = cause ? CAUSES[cause] : "random cause";
    return {
        id: "random", title: `Training computer: ${sev}`, track: ROLE_TRACK[role] || "combat-medic", module: "Random",
        summary: `A casualty from the ACM training computer (${sev.toLowerCase()}, ${why.toLowerCase()}). Training-computer casualties are AI patients: they cannot die from head or torso trauma alone and stay down until revived.`,
        seed, timeLimit, role, patient: { conscious: true }, random: { severity, cause }, loadout: { ...ROLE_LOADOUT[role] },
        objectives: ["Assess the casualty from head to toe", "Stop all bleeding, keep the airway open and treat the chest", "Keep the casualty alive until handover"],
    };
}

/** Every item a scenario can hand out: menu items, fluid bags, vials and syringes. [{ cls, name }] sorted by name. */
export function knownItems(data, catalogue) {
    const set = new Set();
    for (const a of catalogue) for (const i of a.items || []) set.add(i);
    for (const vol of [250, 500, 1000]) for (const t of ["Saline", "Plasma"]) set.add(bagItemClass(t, vol));
    for (const bt of BLOOD_TYPES) for (const vol of [250, 500]) set.add(bagItemClass("Blood", vol, bt));
    for (const d of SYRINGE_DRUGS) set.add(vialItem(d));
    for (const s of SYRINGE_SIZES) set.add(`ACM_Syringe_${s}`);
    for (const r of Object.values(ROLE_LOADOUT)) for (const c of Object.keys(r)) set.add(c);
    return [...set].map((cls) => { const n = itemName(data, cls); return { cls, name: n === cls ? cls.replace(/^AC[EM]_/, "").replace(/_/g, " ") : n }; }).sort((a, b) => a.name.localeCompare(b.name));
}

const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
/** Checks a scenario from the editor or an imported file. Returns { ok, errors: [text] }. */
export function validateScenario(s, data, items = null) {
    const e = [];
    if (!s || typeof s !== "object") return { ok: false, errors: ["Not a scenario object"] };
    if (!String(s.title || "").trim()) e.push("Title is required");
    if (!ROLES.includes(s.role)) e.push(`Role must be one of ${ROLES.join(", ")}`);
    if (!num(s.timeLimit, 60, 3600)) e.push("Time limit must be 60 to 3600 seconds");
    if (s.seed !== undefined && !Number.isInteger(s.seed)) e.push("Seed must be a whole number");
    if (s.patient?.weight !== undefined && !num(s.patient.weight, 40, 150)) e.push("Weight must be 40 to 150 kg");
    if (s.patient?.bloodType !== undefined && !BLOOD_TYPES.includes(s.patient.bloodType)) e.push("Unknown blood type");
    const woundTypes = Object.keys(data.wounds.types || {});
    (s.injuries || []).forEach((w, i) => {
        const n = `Injury ${i + 1}`;
        if (!BODY_PARTS.includes(w.part)) e.push(`${n}: unknown body part`);
        if (w.mechanism) { if (!DAMAGE_TYPES[w.mechanism]) e.push(`${n}: unknown mechanism`); }
        else if (!woundTypes.includes(w.type)) e.push(`${n}: choose a mechanism or a wound type`);
        if (!num(w.damage, 0.01, 20)) e.push(`${n}: damage must be 0.01 to 20`);
        if (w.count !== undefined && !(Number.isInteger(w.count) && w.count >= 1 && w.count <= 10)) e.push(`${n}: count must be 1 to 10`);
    });
    if (!(s.injuries || []).length && !s.random && !s.cbrn) e.push("Add at least one injury");
    if (s.chest) for (const k of ["ptx", "htx"]) if (s.chest[k] !== undefined && !(Number.isInteger(s.chest[k]) && s.chest[k] >= 0 && s.chest[k] <= 10)) e.push(`Chest ${k} must be 0 to 10`);
    const known = items ? new Set(items.map((x) => x.cls)) : null;
    for (const [cls, n] of Object.entries(s.loadout || {})) {
        if (!(Number.isInteger(n) && n >= 0 && n <= 99)) e.push(`${cls}: count must be 0 to 99`);
        if (known && !known.has(cls)) e.push(`Unknown item ${cls}`);
    }
    return { ok: e.length === 0, errors: e };
}

// ------------------------------------------------------------------ replay frames
const OVERLAY_FIELDS = ["tourniquets", "pulseOx", "ivAccess", "ioAccess", "pressureCuff", "thoracostomy", "chestSeal", "airwayNasal", "airwayOral", "fractures", "splints"];
/** What the replay viewer shows for one second: body colours and markers, every part's injury list and the true vitals. */
export function captureFrame(sim) {
    const p = sim.p;
    const o = {
        cbrn: p.cbrn ? { ppe: { mask: p.cbrn.ppe.mask } } : undefined,
        aed: p.aed ? { pads: p.aed.pads, po: p.aed.po, cuff: p.aed.cuff, capno: p.aed.capno } : undefined,
        surgicalAirway: p.surgicalAirway, sa: p.sa ? { strapSecure: p.sa.strapSecure } : undefined, lozenge: p.lozenge || "",
    };
    for (const k of OVERLAY_FIELDS) o[k] = p[k] === undefined ? undefined : JSON.parse(JSON.stringify(p[k]));
    o.splintBone = sim.aceSetting("fractures", 1) >= 2;
    return {
        t: p.t, colors: bodyPartColors(sim), o,
        inj: Object.fromEntries(BODY_PARTS.map((part) => [part, injuryList(sim, part).map((x) => [x.text, x.color])])),
        v: { alive: p.alive, unc: p.unconscious, ca: p.cardiacArrest, hr: Math.round(p.hr), sys: Math.round(p.bp[1]), dia: Math.round(p.bp[0]), spo2: Math.round(p.spo2 * 10) / 10, rr: Math.round(p.rr), bv: Math.round(p.bloodVolume * 100) / 100 },
    };
}
/**
 * Appends a frame as a delta: body overlay (o) and injury lists (inj) are stored only when they change, colours and
 * vitals every second. frameAt() rebuilds the full frame. A 15-minute run is roughly 150 kB of JSON.
 */
export function pushFrame(frames, f) {
    let lo = null, li = null;
    for (let k = frames.length - 1; k >= 0 && (lo === null || li === null); k--) {
        if (lo === null && frames[k].o) lo = frames[k].o;
        if (li === null && frames[k].inj) li = frames[k].inj;
    }
    const d = { t: f.t, colors: f.colors, v: f.v };
    if (JSON.stringify(lo) !== JSON.stringify(f.o)) d.o = f.o;
    if (JSON.stringify(li) !== JSON.stringify(f.inj)) d.inj = f.inj;
    frames.push(d);
    return d;
}
export function frameAt(frames, t) {
    let r = null;
    for (const f of frames) {
        if (r && f.t > t) break;
        r = { ...r, ...f, o: f.o || r?.o, inj: f.inj || r?.inj };
    }
    return r;
}

// ------------------------------------------------------------------ records
export const RECORD_COLUMNS = ["date", "scenario", "module", "title", "role", "seed", "result", "score", "outcome", "duration", "criticalFails", "failedChecks", "hints"];
const csvCell = (v) => { const s = v === undefined || v === null ? "" : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; };
/** CSV (RFC 4180, formula-safe) of practice records. */
export function recordsToCSV(records) {
    const rows = [RECORD_COLUMNS.join(",")];
    for (const r of records) rows.push(RECORD_COLUMNS.map((c) => csvCell(Array.isArray(r[c]) ? r[c].join("; ") : r[c])).join(","));
    return rows.join("\r\n") + "\r\n";
}
/** Builds a record from a finished run. */
export function makeRecord(scn, seed, sim, res, date = new Date()) {
    const p = sim.p;
    return {
        date: date.toISOString(), scenario: scn.id, module: scn.module, title: scn.title, role: scn.role, seed,
        result: res ? (res.passed ? "GO" : "NO-GO") : "", score: res ? Math.round(res.score * 100) : "",
        outcome: p.alive ? (p.woundBleeding > 0 ? "Alive, still bleeding" : "Alive") : `Died: ${p.causeOfDeath}`,
        duration: p.t, criticalFails: res ? res.criticalFails.map((r) => r.check.id) : [],
        failedChecks: res ? res.results.filter((r) => r.status === "fail").map((r) => r.check.id) : [],
    };
}
