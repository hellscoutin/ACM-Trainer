// Rubric scoring (docs/TRAINER-design.md section 6). A rubric is a list of checks evaluated after the run against:
//   - the treatment log: sim.menuLog [{ t, id, part, ok, state }]  (menu actions as the trainee chose them)
//   - simulation events: sim.events [{ t, event, ... }]
//   - a per-second history of key state: recorder.history [keyState]
// Checks are data (rubrics/*.json), so instructors can write their own later.
import { BODY_PARTS } from "./util.js";
import { airwayState } from "./oxygen.js";
import { noteFinding } from "./guidance.js";
import { isBloodCompatible } from "./blood.js";

/** Flat snapshot of the state that checks can test. */
export function keyState(sim) {
    const p = sim.p;
    const s = {
        t: p.t, alive: p.alive, unconscious: p.unconscious, cardiacArrest: p.cardiacArrest, rhythm: p.rhythm,
        bloodVolume: p.bloodVolume, spo2: p.spo2, hr: p.hr, rr: p.rr, systolic: p.bp[1], map: p.bp[0] + (p.bp[1] - p.bp[0]) / 3,
        woundBleeding: p.woundBleeding, internalBleeding: p.internalBleeding, pain: Math.max(0, p.pain - p.painSuppress),
        ptx: p.ptx, tensionPtx: p.tensionPtx, htxFluid: p.htxFluid, htxState: p.htxState || 0, chestSeal: p.chestSeal,
        airwayBlocked: p.alive && p.unconscious && airwayState(p) === 0, obstructed: p.obstructionVomit + p.obstructionBlood > 0,
        recoveryPosition: p.recoveryPosition, cpr: p.cpr, bvm: p.bvm,
        platelets: p.platelets, overload: p.overload, transfused: p.transfused, calcium: p.calcium, hemolytic: (p.reactionSeverity || 0) > 0,
        incompatibleBags: p.ivBags.filter((b) => b.type === "Blood" && !isBloodCompatible(sim.data, p.bloodType, b.bloodType)).length,
        inCloud: !!p.cbrn?.inCloud, sarin: p.cbrn?.buildup.Sarin ?? 0, lewisite: p.cbrn?.buildup.Lewisite ?? 0, spasm: !!p.cbrn?.spasm, atropine: sim.medCount("Atropine") + sim.medCount("Atropine_IV"),
    };
    BODY_PARTS.forEach((part, i) => {
        s[`bleeding_${part}`] = p.tourniquets[i] ? 0 : p.openWounds[part].reduce((a, w) => a + (w.count > 0 ? w.count * w.bleeding : 0), 0);
        s[`tourniquet_${part}`] = !!p.tourniquets[i];
        s[`fracture_${part}`] = p.fractures?.[i] ?? 0;
    });
    return s;
}

/** Records history once per simulated second and keeps the treatment log on the simulation. */
export function createRecorder(sim) {
    sim.menuLog ??= [];
    const rec = { history: [keyState(sim)] };
    rec.tick = () => rec.history.push(keyState(sim));
    rec.action = (id, part, ok = true, detail) => { if (ok) noteFinding(sim, id, part); sim.menuLog.push({ t: sim.p.t, id, part, ok, detail, state: keyState(sim) }); };
    return rec;
}

// ------------------------------------------------------------------ predicates
const OPS = { "==": (a, b) => a === b, "!=": (a, b) => a !== b, "<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b };
/** { field, op, value } | { all: [...] } | { any: [...] } | { not: pred } */
export function test(pred, s) {
    if (!pred) return true;
    if (pred.all) return pred.all.every((x) => test(x, s));
    if (pred.any) return pred.any.some((x) => test(x, s));
    if (pred.not) return !test(pred.not, s);
    const fn = OPS[pred.op || "=="];
    if (!fn) throw new Error("Unknown operator " + pred.op);
    return fn(s[pred.field], pred.value);
}

const matchAction = (check, e) => e.ok && check.actions.includes(e.id) && (!check.parts || check.parts.includes(e.part)) && (!check.detail || test(check.detail, e.detail || {}));
const matchEvent = (spec, e) => e.event === spec.event && Object.entries(spec.match || {}).every(([k, v]) => e[k] === v);

/** Time a check counts from: start (0) or the first matching event (null if it never happened). */
function anchor(from, events) {
    if (!from || from === "start") return 0;
    const e = events.find((x) => matchEvent(from, x));
    return e ? e.t : null;
}

const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * Evaluates one check. Returns { status: "pass" | "fail" | "na", detail }.
 * Types:
 *   action-within       an action from `actions` (optionally on `parts`) within `within` s of `from` (start or {event})
 *   action-done         an action from `actions` at any time
 *   action-before-event an action before the first `event` (pass if the event never happens and the action was done,
 *                       or with `naIfNoEvent` not applicable when the event never happens)
 *   action-order        every `first` action on `parts` comes before any `then` action on `parts`
 *   action-forbidden    none of `actions` done while `when` was true (state at the time of the action)
 *   event-within        `event` (with `match`) within `within` s of `from`
 *   event-never         `event` (with `match`) never happens
 *   state-within        predicate `state` becomes true within `within` s of `from` (na if `from` never happens)
 *   state-duration-max  predicate `state` true for at most `max` s in total
 *   end-state           predicate `state` true at the end
 */
export function evaluateCheck(check, { log, events, history, end }) {
    switch (check.type) {
        case "action-within": {
            const t0 = anchor(check.from, events);
            if (t0 === null) return { status: "na", detail: "Did not arise" };
            const hit = log.find((e) => matchAction(check, e) && e.t >= t0);
            if (!hit) return { status: "fail", detail: "Not done" };
            const dt = hit.t - t0;
            return dt <= check.within ? { status: "pass", detail: `Done at ${fmt(hit.t)} (${Math.round(dt)} s)` } : { status: "fail", detail: `Done at ${fmt(hit.t)}, ${Math.round(dt)} s (limit ${check.within} s)` };
        }
        case "action-done": {
            const hit = log.find((e) => matchAction(check, e));
            return hit ? { status: "pass", detail: `Done at ${fmt(hit.t)}` } : { status: "fail", detail: "Not done" };
        }
        case "action-before-event": {
            const ev = events.find((e) => matchEvent(check, e));
            const hit = log.find((e) => matchAction(check, e) && (!ev || e.t <= ev.t));
            if (!ev && check.naIfNoEvent && !hit) return { status: "na", detail: "Did not arise" };
            if (hit) return { status: "pass", detail: `Done at ${fmt(hit.t)}${ev ? `, before ${fmt(ev.t)}` : ""}` };
            return { status: "fail", detail: ev ? `Not done before ${fmt(ev.t)}` : "Not done" };
        }
        case "action-order": {
            const parts = check.parts;
            const inPart = (e) => !parts || parts.includes(e.part);
            const first = log.find((e) => e.ok && check.first.includes(e.id) && inPart(e));
            const then = log.find((e) => e.ok && check.then.includes(e.id) && inPart(e));
            if (!then) return first ? { status: "pass", detail: `Done at ${fmt(first.t)}` } : { status: "na", detail: "Not applicable" };
            if (first && first.t <= then.t) return { status: "pass", detail: `${fmt(first.t)} before ${fmt(then.t)}` };
            return { status: "fail", detail: first ? `${fmt(then.t)} came before ${fmt(first.t)}` : `Only the later step was done (${fmt(then.t)})` };
        }
        case "action-forbidden": {
            const bad = log.filter((e) => e.ok && check.actions.includes(e.id) && (!check.parts || check.parts.includes(e.part)) && test(check.when, e.state));
            return bad.length ? { status: "fail", detail: `At ${bad.map((e) => fmt(e.t)).join(", ")}` } : { status: "pass", detail: "Never done" };
        }
        case "event-within": {
            const t0 = anchor(check.from, events);
            if (t0 === null) return { status: "na", detail: "Did not arise" };
            const ev = events.find((e) => matchEvent(check, e) && e.t >= t0);
            if (!ev) return { status: "fail", detail: "Not done" };
            return ev.t - t0 <= check.within ? { status: "pass", detail: `At ${fmt(ev.t)}` } : { status: "fail", detail: `At ${fmt(ev.t)} (limit ${check.within} s)` };
        }
        case "event-never": {
            const ev = events.find((e) => matchEvent(check, e));
            return ev ? { status: "fail", detail: `At ${fmt(ev.t)}` } : { status: "pass", detail: "Never" };
        }
        case "state-within": {
            const t0 = anchor(check.from, events);
            if (t0 === null) return { status: "na", detail: "Did not arise" };
            const hit = history.find((s) => s.t >= t0 && test(check.state, s));
            if (!hit) return { status: "fail", detail: "Never reached" };
            return hit.t - t0 <= check.within ? { status: "pass", detail: `At ${fmt(hit.t)}` } : { status: "fail", detail: `At ${fmt(hit.t)} (limit ${check.within} s)` };
        }
        case "state-duration-max": {
            const n = history.filter((s, i) => i > 0 && test(check.state, s)).length;
            return n <= check.max ? { status: "pass", detail: `${n} s` } : { status: "fail", detail: `${n} s (limit ${check.max} s)` };
        }
        case "end-state":
            return test(check.state, end) ? { status: "pass", detail: "Met at the end" } : { status: "fail", detail: "Not met at the end" };
        default:
            throw new Error("Unknown check type " + check.type);
    }
}

/**
 * Scores a run. Returns { score (0-1), passed, criticalFails, results: [{ check, status, detail }], passMark }.
 * Not-applicable checks are left out of the score. Any failed critical check is an automatic no-go.
 */
export function scoreRun(rubric, sim, recorder) {
    const ctx = { log: sim.menuLog || [], events: sim.events, history: recorder.history, end: recorder.history.at(-1) };
    const results = rubric.checks.map((check) => ({ check, ...evaluateCheck(check, ctx) }));
    const counted = results.filter((r) => r.status !== "na");
    const total = counted.reduce((a, r) => a + (r.check.weight ?? 1), 0);
    const got = counted.filter((r) => r.status === "pass").reduce((a, r) => a + (r.check.weight ?? 1), 0);
    const score = total ? got / total : 1;
    const criticalFails = results.filter((r) => r.check.critical && r.status === "fail");
    const passMark = rubric.passMark ?? 0.7;
    return { score, passed: score >= passMark && criticalFails.length === 0, criticalFails, results, passMark };
}
