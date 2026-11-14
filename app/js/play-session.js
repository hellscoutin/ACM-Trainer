// Trainee side of an instructor-led session: loads the session's scenario, follows the instructor's clock and
// commands, publishes a live snapshot every 2 s and stores the result. Used by play.js when ?session=CODE is set.
import { db, doc, getDoc, setDoc, addDoc, collection, onSnapshot, serverTimestamp, ready, signInGuest } from "./cloud.js";
import { randomScenario } from "../../engine/custom.js";
import { applyInject, applySet, snapshot } from "../../engine/session.js";

/** FNV-1a: a per-trainee seed when the instructor wants a different patient for everyone. */
function hashSeed(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 1e9; }

export async function joinSession(code) {
    const user = (await ready) || (await signInGuest());
    const sref = doc(db, "sessions", code);
    const s = await getDoc(sref);
    if (!s.exists()) throw new Error("There is no session with this code.");
    const session = s.data();
    const rref = doc(db, "sessions", code, "runs", user.uid);
    const r = await getDoc(rref);
    if (!r.exists()) { location.href = `join.html?code=${code}`; throw new Error("Not joined"); }
    const run = r.data();
    const round = session.round || 1;
    const seed = session.sameSeed ? session.seed : hashSeed(`${user.uid}:${round}:${session.seed}`);
    const sc = session.scenario || {};
    let scn;
    if (sc.random) scn = randomScenario({ ...sc.random, seed });
    else if (sc.custom) scn = sc.custom;
    else scn = await fetch(`../scenarios/${encodeURIComponent(sc.id)}.json`).then((x) => x.json());
    return { code, user, session, run, round, scn, seed, sref, rref, attach: (api) => attach({ code, user, session, run, round, scn, seed, sref, rref }, api) };
}

/**
 * api: { getSim, getState, recorder, setClock(speed), lockClock(bool), enableStart(bool), autoStart(), end(reason), notice(text),
 *        timeline(text), limitHints(depth), currentAction() }
 */
function attach(ctx, api) {
    const { code, user, run, round, scn, seed, sref, rref } = ctx;
    let session = ctx.session, localPause = false, begun = false, finished = false, lastKey = "";
    const instructorClock = () => session.timeControl !== "trainee";
    api.limitHints(session.hints ?? 0);
    api.lockClock(instructorClock());

    function clock() {
        const halted = session.phase !== "running" || session.paused || localPause;
        if (instructorClock()) api.setClock(halted || !begun ? 0 : session.speed || 1);
        else if (halted) api.setClock(0);
        api.lockClock(instructorClock() || halted);
    }
    function begin() {
        if (begun) return;
        begun = true;
        api.autoStart();
        clock();
    }
    onSnapshot(sref, (d) => {
        if (!d.exists()) return;
        session = d.data();
        if ((session.round || 1) !== round && !finished) { location.reload(); return; }
        if ((session.round || 1) !== round) { api.notice("The instructor started a new round. Reload the page to join it."); return; }
        if (session.status !== "open") api.notice("The instructor closed the session.");
        if (session.phase === "running") { api.enableStart(true); if (instructorClock()) begin(); }
        if (session.phase === "ended" && !api.getState().ended) api.end("The instructor ended the scenario.");
        clock();
    });
    api.onStart = () => { begun = true; clock(); };

    // instructor commands (only those sent after this page opened, for this trainee or everyone, this round)
    let first = true;
    const seen = new Set();
    onSnapshot(collection(db, "sessions", code, "commands"), (snap) => {
        for (const ch of snap.docChanges()) {
            const id = ch.doc.id;
            if (seen.has(id)) continue;
            seen.add(id);
            if (first || ch.type !== "added") continue;
            const c = ch.doc.data();
            if ((c.round || 1) !== round || (c.target !== "all" && c.target !== user.uid)) continue;
            const sim = api.getSim();
            if (c.type === "pause") { localPause = true; clock(); api.notice("Paused by the instructor"); }
            else if (c.type === "resume") { localPause = false; clock(); api.notice("Resumed"); }
            else if (c.type === "message") api.notice(String(c.text || "").slice(0, 300));
            else if (c.type === "end") api.end("The instructor ended the scenario.");
            else if (c.type === "inject") {
                const text = applyInject(sim, c.kind, c.args || {});
                if (text) { api.recorder.action(`inject_${c.kind}`, c.args?.part || null, true, { inject: c.kind }); api.timeline(`Instructor inject: ${text}`); }
            } else if (c.type === "set") {
                const text = applySet(sim, c.field, c.value);
                if (text) { api.recorder.action(`set_${c.field}`, null, true, { value: c.value }); api.timeline(`Instructor: ${text}`); }
            }
        }
        first = false;
    });

    // live snapshot every 2 s (only when something changed)
    const publish = async (force = false) => {
        const sim = api.getSim(), state = api.getState();
        const status = state.ended ? "ended" : begun ? "running" : "waiting";
        const current = api.currentAction();
        const key = `${sim.p.t}|${status}|${current}|${localPause}|${state.hints}`;
        if (!force && key === lastKey) return;
        lastKey = key;
        const actions = (sim.menuLog || []).filter((e) => e.ok).map((e) => ({ t: e.t, id: e.id, part: e.part || null }));
        try {
            await setDoc(rref, { ...snapshot(sim, { status, current, hints: state.hints, actions }), paused: localPause, round, scenarioId: scn.id, title: scn.title, module: scn.module || "", seed, name: run.name }, { merge: true });
        } catch { /* offline or closed: the next publish retries */ }
    };
    setInterval(publish, 2000);
    publish(true);

    return {
        begun: () => begun,
        canStart: () => session.phase === "running",
        /** Called from the debrief: final snapshot, result on the run and an append-only results record. */
        async finish(record) {
            if (finished) return;
            finished = true;
            await publish(true);
            const result = { score: record.score, result: record.result, outcome: record.outcome, duration: record.duration, failedChecks: record.failedChecks, criticalFails: record.criticalFails, hints: record.hints || "Off" };
            try {
                await setDoc(rref, { status: "ended", result }, { merge: true });
                await addDoc(collection(db, "results"), { ...record, uid: user.uid, name: run.name, session: code, round, at: serverTimestamp() });
            } catch { /* rules or network: the instructor still sees the final snapshot */ }
        },
    };
}
