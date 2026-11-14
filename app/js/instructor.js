// Instructor dashboard: Discord sign-in, create sessions, watch trainees live, control the clock and send commands.
import {
    db, doc, getDoc, setDoc, updateDoc, addDoc, collection, onSnapshot, serverTimestamp, query, where, getDocs,
    ready, completeDiscordSignIn, discordSignIn, signOut, isDiscord, isInstructor, displayName, newCode,
} from "./cloud.js";
import { buildCatalogue } from "../../engine/menu.js";
import { INJECTS, SETTABLE } from "../../engine/session.js";
import { MECHANISMS, MECHANISM_NAMES, recordsToCSV, RECORD_COLUMNS } from "../../engine/custom.js";
import { formatTime, PART_NAMES } from "../../engine/injuryList.js";
import { BODY_PARTS } from "../../engine/util.js";
import { createBody } from "./body.js";
import { loadCustom, download } from "./store.js";
import { labelProblems, renderProblems, renderClinical } from "./clinical-view.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
const params = new URLSearchParams(location.search);

const [data, index] = await Promise.all([fetch("../data/acm-1.4.8.json").then((r) => r.json()), fetch("../scenarios/index.json").then((r) => r.json())]);
const builtIn = await Promise.all(index.scenarios.map((id) => fetch(`../scenarios/${id}.json`).then((r) => r.json())));
const labels = Object.fromEntries(buildCatalogue(data).map((a) => [a.id, a.label]));
const actionLabel = (id) => labels[id] || (id.startsWith("inject_") ? `Inject: ${INJECTS[id.slice(7)]?.label || id}` : id.startsWith("set_") ? `Set ${id.slice(4)}` : id);

let user = null, session = null, sessionRef = null, runs = new Map(), selected = null, unsubs = [];

// ------------------------------------------------------------------ sign-in
const back = await completeDiscordSignIn();
user = await ready;
async function renderAuth() {
    const box = $("auth");
    box.textContent = "";
    if (back?.error) box.append(el("p", { className: "errors", textContent: `Sign-in failed: ${back.error}` }));
    if (!isDiscord(user)) {
        const b = el("button", { className: "btn primary", textContent: "Sign in with Discord" });
        b.addEventListener("click", discordSignIn);
        box.append(b, el("span", { className: "muted", textContent: "Instructors sign in with Discord to create and run sessions." }));
        return false;
    }
    const out = el("button", { className: "btn", textContent: "Sign out" });
    out.addEventListener("click", async () => { await signOut(); location.href = "instructor.html"; });
    box.append(el("span", { textContent: `Signed in as ${displayName(user)}` }), out);
    if (!(await isInstructor(user))) {
        box.append(el("p", { className: "warn-text" }, "Your account is not on the instructor list yet. Ask the project owner to add a document with this ID to the ",
            el("code", { textContent: "instructors" }), " collection in Firestore: ", el("code", { textContent: user.uid })));
        return false;
    }
    return true;
}
const ok = await renderAuth();

// ------------------------------------------------------------------ setup
function scenarioOptions(sel) {
    sel.textContent = "";
    const groups = {};
    for (const t of index.tracks) groups[t.id] = el("optgroup", { label: t.title });
    for (const s of builtIn) groups[s.track]?.append(el("option", { value: "b:" + s.id, textContent: `${s.module}: ${s.title}` }));
    sel.append(el("option", { value: "random", textContent: "Training computer (random casualty)" }), ...Object.values(groups));
    const mine = Object.values(loadCustom());
    if (mine.length) sel.append(el("optgroup", { label: "Your custom scenarios (this browser)" }, ...mine.map((s) => el("option", { value: "c:" + s.id, textContent: s.title }))));
}
function scenarioSpec(v) {
    if (v === "random") return { random: { severity: Number($("rSev").value), cause: Number($("rCause").value), role: $("rRole").value } };
    if (v.startsWith("c:")) { const { custom, ...s } = loadCustom()[v.slice(2)]; return { custom: s }; }
    return { id: v.slice(2) };
}
const specTitle = (sc) => (sc.random ? "Training computer (random)" : sc.custom ? sc.custom.title : builtIn.find((s) => s.id === sc.id)?.title || sc.id);

async function setup() {
    $("setup").hidden = false;
    scenarioOptions($("scenario"));
    $("scenario").addEventListener("change", () => { $("randomOpts").hidden = $("scenario").value !== "random"; });
    $("newForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        $("createBtn").disabled = true;
        $("createStatus").textContent = "Creating…";
        try {
            let code;
            for (let i = 0; i < 5; i++) { code = newCode(); if (!(await getDoc(doc(db, "sessions", code))).exists()) break; }
            await setDoc(doc(db, "sessions", code), {
                code, instructor: user.uid, instructorName: displayName(user), createdAt: serverTimestamp(), status: "open", phase: "lobby",
                paused: false, speed: 1, round: 1, scenario: scenarioSpec($("scenario").value), seed: $("scenario").value === "random" ? Math.floor(Math.random() * 1e9) : null,
                sameSeed: $("sameSeed").value === "1", hints: Number($("hints").value), timeControl: $("timeControl").value,
            });
            location.href = `instructor.html?code=${code}`;
        } catch (err) { $("createStatus").textContent = `Could not create the session (${err.code || err.message}).`; $("createBtn").disabled = false; }
    });
    const snap = await getDocs(query(collection(db, "sessions"), where("instructor", "==", user.uid)));
    const list = snap.docs.map((d) => d.data()).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 15);
    for (const s of list) {
        const a = el("a", { href: `instructor.html?code=${s.code}`, textContent: `${s.code} · ${specTitle(s.scenario)} · round ${s.round || 1}` });
        $("recent").append(el("li", {}, a, el("span", { className: "muted", textContent: ` ${s.status}${s.createdAt ? " · " + new Date(s.createdAt.seconds * 1000).toLocaleString() : ""}` })));
    }
    if (!list.length) $("recent").append(el("li", { className: "muted", textContent: "No sessions yet." }));
}

// ------------------------------------------------------------------ dashboard
const command = (target, type, extra = {}) => addDoc(collection(db, "sessions", session.code, "commands"), { target, type, ...extra, round: session.round || 1, at: serverTimestamp(), by: user.uid });

function dashboard(code) {
    $("dash").hidden = false;
    sessionRef = doc(db, "sessions", code);
    const joinUrl = new URL(`join.html?code=${code}`, location.href).href;
    $("dCode").textContent = code;
    $("dJoin").textContent = `Trainees open ${joinUrl}`;
    unsubs.push(onSnapshot(sessionRef, (d) => {
        if (!d.exists()) return;
        session = d.data();
        if (session.instructor !== user.uid) { $("dash").innerHTML = '<p class="errors">This session belongs to another instructor.</p>'; return; }
        $("dScenario").textContent = `Round ${session.round || 1}: ${specTitle(session.scenario)}`;
        $("dPhase").textContent = `${{ lobby: "Waiting to start", running: session.paused ? "Paused" : "Running", ended: "Scenario ended" }[session.phase]} · ${session.status === "open" ? "open" : "closed"} · hints ${["off", "Basic", "Intermediate", "Advanced"][session.hints] || "off"} · ${session.timeControl === "trainee" ? "trainees control speed" : `speed ${session.speed}×`}`;
        $("startBtn").disabled = session.phase !== "lobby";
        $("pauseBtn").textContent = session.paused ? "Resume all" : "Pause all";
        $("pauseBtn").disabled = session.phase !== "running";
        for (const b of $("speedGroup").querySelectorAll("button")) { b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === session.speed)); b.disabled = session.timeControl === "trainee"; }
        renderTiles();
    }));
    unsubs.push(onSnapshot(collection(db, "sessions", code, "runs"), (snap) => {
        for (const d of snap.docs) runs.set(d.id, d.data());
        renderTiles();
        if (selected) renderDetail();
    }));
    $("startBtn").addEventListener("click", () => updateDoc(sessionRef, { phase: "running", paused: false }));
    $("pauseBtn").addEventListener("click", () => updateDoc(sessionRef, { paused: !session.paused }));
    $("speedGroup").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) updateDoc(sessionRef, { speed: Number(b.dataset.speed) }); });
    $("endBtn").addEventListener("click", () => { if (confirm("End the scenario for everyone? Each trainee gets their debrief.")) updateDoc(sessionRef, { phase: "ended" }); });
    $("closeBtn").addEventListener("click", () => { if (confirm("Close the session? Trainees can no longer join or send updates.")) updateDoc(sessionRef, { status: "closed", phase: "ended" }); });
    $("msgAllBtn").addEventListener("click", () => { const t = prompt("Message to all trainees"); if (t) command("all", "message", { text: t.slice(0, 300) }); });
    $("roundBtn").addEventListener("click", newRound);
    $("csvBtn").addEventListener("click", exportCSV);
    setupDetailControls();
}

function newRound() {
    const dlg = el("div", { className: "modal-back show" });
    const sel = el("select", {});
    scenarioOptions(sel);
    const go = el("button", { className: "btn primary", textContent: "Start new round" }), cancel = el("button", { className: "btn", textContent: "Cancel" });
    dlg.append(el("div", { className: "modal" }, el("h2", { textContent: "New round" }), el("p", { textContent: "Trainees on the session page reload into the new scenario. Random casualties use the severity, cause and role set in the new-session form." }),
        el("label", {}, "Scenario ", sel), el("div", { className: "buttons" }, cancel, go)));
    document.body.append(dlg);
    cancel.addEventListener("click", () => dlg.remove());
    go.addEventListener("click", async () => {
        await updateDoc(sessionRef, { scenario: scenarioSpec(sel.value), round: (session.round || 1) + 1, phase: "lobby", paused: false, seed: sel.value === "random" ? Math.floor(Math.random() * 1e9) : null });
        dlg.remove();
    });
}

const roundRuns = () => [...runs.values()].filter((r) => (r.round || 1) === (session?.round || 1)).sort((a, b) => a.name.localeCompare(b.name));
function renderTiles() {
    if (!session) return;
    const box = $("tiles");
    box.textContent = "";
    const list = roundRuns();
    if (!list.length) box.append(el("p", { className: "muted", textContent: "No trainees yet. Give them the code above." }));
    for (const r of list) {
        const v = r.vitals || {};
        const state = !r.status || r.status === "waiting" ? "Waiting" : !r.alive ? "Dead" : r.cardiacArrest ? "Arrest" : r.unconscious ? "Unconscious" : "Conscious";
        const tile = el("button", { className: "tile" + (r.alerts?.length ? " alert" : "") + (selected === r.uid ? " selected" : "") });
        tile.append(
            el("div", { className: "tile-head" }, el("strong", { textContent: r.name }), el("span", { className: "muted", textContent: r.t ? formatTime(r.t) : "" })),
            el("div", { className: "tile-state", textContent: `${state}${r.paused ? " · paused" : ""}${r.status === "ended" ? " · ended" : ""}` }),
            el("div", { className: "tile-vitals", textContent: r.vitals ? `HR ${v.hr} · BP ${v.sys}/${v.dia} · SpO2 ${v.spo2} % · BV ${v.bv} L` : "" }),
            el("div", { className: "tile-current", textContent: r.current ? `Doing: ${r.current}` : r.actions?.length ? `Last: ${actionLabel(r.actions.at(-1).id)}` : "" }),
            el("div", { className: "tile-alerts", textContent: (r.alerts || []).join(" · ") }),
            el("div", { className: "tile-result", textContent: r.result ? `${r.result.result || ""} ${r.result.score !== "" ? r.result.score + " %" : ""} · ${r.result.outcome}` : "" }));
        tile.addEventListener("click", () => { selected = r.uid; renderTiles(); renderDetail(); });
        box.append(tile);
    }
}

let mirror = null, mirrorPart = "body", fullView = false;
function renderDetail() {
    const r = runs.get(selected);
    if (!r) return;
    $("detail").hidden = false;
    $("tName").textContent = `${r.name}: ${r.title || ""}`;
    if (!mirror) mirror = createBody($("tBody"), (p) => { mirrorPart = p; renderDetail(); });
    let f = null;
    try { f = r.frame ? JSON.parse(r.frame) : null; } catch { f = null; }
    if (f) mirror.update(f.colors, mirrorPart, { tourniquets: [], pulseOx: [], ivAccess: [], ioAccess: [], ...f.o });
    $("tPart").textContent = PART_NAMES[mirrorPart];
    $("tInj").textContent = "";
    for (const [text, color] of f?.inj?.[mirrorPart] || []) { const li = el("li", { textContent: text || " " }); li.style.color = color; $("tInj").append(li); }
    const v = r.vitals || {}, s = r.visible || {};
    $("tVitals").innerHTML = "";
    const rows = fullView
        ? [["Heart rate", v.hr, "Blood pressure", `${v.sys}/${v.dia}`], ["SpO2", `${v.spo2} %`, "Respiration", `${v.rr} /min`], ["Blood volume", `${v.bv} L`, "Rhythm", r.rhythm || ""], ["Bleeding", `${v.bleeding} ml/min`, "Internal", `${v.ib} ml/min`]]
        // as the trainee sees it: only what devices show (pulse oximeter, AED monitor or cuff) and the obvious state
        : [["State", !r.alive ? "Dead" : s.unconscious ? "Unconscious" : "Conscious", "SpO2 (device)", s.spo2 ?? "not measured"], ["Heart rate (device)", s.hr ?? "not measured", "Systolic (device)", s.sys ?? "not measured"]];
    $("tVitalsTitle").textContent = fullView ? "True vitals" : "What the trainee can see";
    for (const [a, b, c, d] of rows) $("tVitals").append(el("tr", {}, el("th", { textContent: a }), el("td", { textContent: b ?? "" }), el("th", { textContent: c }), el("td", { textContent: d ?? "" })));
    $("tFull").hidden = !fullView;
    if (fullView) {
        renderClinical($("tClinical"), r.clinical);
        renderProblems($("tProblems"), labelProblems(r.problems || [], actionLabel));
    }
    $("tActions").textContent = "";
    for (const a of (r.actions || []).slice().reverse()) $("tActions").append(el("li", {}, el("time", { textContent: formatTime(a.t) }), `${actionLabel(a.id)}${a.part ? ` (${PART_NAMES[a.part] || a.part})` : ""}`));
    $("tPause").textContent = r.paused ? "Resume" : "Pause";
}
function setupDetailControls() {
    for (const [k, v] of Object.entries(INJECTS)) $("injKind").append(el("option", { value: k, textContent: v.label }));
    for (const p of BODY_PARTS) $("injPart").append(el("option", { value: p, textContent: PART_NAMES[p] }));
    for (const m of MECHANISMS) $("injMech").append(el("option", { value: m, textContent: MECHANISM_NAMES[m] }));
    for (const [k, v] of Object.entries(SETTABLE)) $("setField").append(el("option", { value: k, textContent: v.label }));
    const argsVisible = () => { const a = INJECTS[$("injKind").value].args; $("injPart").hidden = !a.includes("part"); $("injMech").hidden = !a.includes("mechanism"); $("injDmg").hidden = !a.includes("damage"); };
    $("injKind").addEventListener("change", argsVisible);
    argsVisible();
    const setView = (full) => { fullView = full; $("viewFull").setAttribute("aria-pressed", String(full)); $("viewTrainee").setAttribute("aria-pressed", String(!full)); renderDetail(); };
    $("viewTrainee").addEventListener("click", () => setView(false));
    $("viewFull").addEventListener("click", () => setView(true));
    $("detailClose").addEventListener("click", () => { selected = null; $("detail").hidden = true; renderTiles(); });
    $("tPause").addEventListener("click", () => { const r = runs.get(selected); command(selected, r?.paused ? "resume" : "pause"); });
    $("injBtn").addEventListener("click", () => command(selected, "inject", { kind: $("injKind").value, args: { part: $("injPart").value, mechanism: $("injMech").value, damage: Number($("injDmg").value) } }));
    $("setBtn").addEventListener("click", () => { if ($("setValue").value !== "") command(selected, "set", { field: $("setField").value, value: Number($("setValue").value) }); });
    $("tMsg").addEventListener("click", () => { const t = prompt(`Message to ${runs.get(selected)?.name}`); if (t) command(selected, "message", { text: t.slice(0, 300) }); });
    $("tEnd").addEventListener("click", () => { if (confirm("End the scenario for this trainee?")) command(selected, "end"); });
}

function exportCSV() {
    const rows = [...runs.values()].filter((r) => r.result).map((r) => ({
        date: new Date().toISOString(), scenario: r.scenarioId, module: r.module, title: r.title, role: r.role || "", seed: r.seed, result: r.result.result, score: r.result.score,
        outcome: r.result.outcome, duration: r.result.duration, criticalFails: r.result.criticalFails || [], failedChecks: r.result.failedChecks || [], hints: r.result.hints, trainee: r.name, round: r.round,
    }));
    download(`acm-trainer-session-${session.code}.csv`, recordsToCSV(rows, ["trainee", "round", ...RECORD_COLUMNS]), "text/csv");
}

if (ok) { if (params.get("code")) dashboard(params.get("code").toUpperCase()); else await setup(); }
