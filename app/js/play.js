// Solo practice: runs a scenario in the browser with the ACM medical menu.
import { loadScenario, runTimeline, ROLE_LEVEL } from "../../engine/scenario.js";
import { CATEGORIES, buildCatalogue, available, actionTime, pickItem, itemName, markTreated } from "../../engine/menu.js";
import { injuryList, bodyPartColors, formatTime, PART_NAMES } from "../../engine/injuryList.js";
import { feelPulse, updatePulseOximeters } from "../../engine/exams.js";
import { createBody } from "./body.js";
import { audio, openBP, openStethoscope, openTransfusion } from "./windows.js";
import { createRecorder, scoreRun } from "../../engine/scoring.js";
import { openSyringe, openAED, aedAmbient } from "./windows-med.js";
import { drawSyringe, injectSyringe, drugName } from "../../engine/syringes.js";
import { aedState } from "../../engine/aed.js";
import { openCric } from "./windows-cric.js";
import { endProcedure } from "../../engine/surgicalAirway.js";
import { randomScenario, GENERIC_RUBRIC, captureFrame, pushFrame, makeRecord } from "../../engine/custom.js";
import { getCustom, addRecord, addReplay, storageOK } from "./store.js";
import { mountReplay } from "./replay.js";
import { evaluateGuidance, DEPTHS } from "../../engine/guidance.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };

const CAT_ICONS = {
    examine: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l6 6" stroke="currentColor" stroke-width="2"/></svg>',
    bandage: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="8" width="20" height="8" rx="4" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(-35 12 12)"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/></svg>',
    medication: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l5-5M8 12l4 4M10 6l8 8-3 3-8-8z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M17 3l4 4" stroke="currentColor" stroke-width="2"/></svg>',
    airway: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v7M12 10c-3 0-7 3-7 8 0 2 2 3 4 2l3-4M12 10c3 0 7 3 7 8 0 2-2 3-4 2l-3-4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    advanced: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    drag: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="15" cy="4.5" r="2" fill="currentColor"/><path d="M14 8l-4 4 3 2v6M10 12l-5 2M13 14l4 1 2 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    interact: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13V5a1.5 1.5 0 013 0v6m0-1V4a1.5 1.5 0 013 0v7m0-5a1.5 1.5 0 013 0v7m0-3a1.5 1.5 0 013 0v4c0 4-3 7-7 7h-1c-3 0-4-1-6-4l-3-4c-.8-1 .6-2.6 1.8-1.6L8 15" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
};

const params = new URLSearchParams(location.search);
// Scenario sources: ?s=<id> (built-in file), ?c=<id> (custom, from this browser), ?random=1&sev=&cause=&role= (training computer),
// ?session=CODE (instructor-led session: the scenario, seed, hints and clock come from the session)
const sessionCode = params.get("session");
let S = null;
if (sessionCode) {
    try { S = await (await import("./play-session.js")).joinSession(sessionCode.toUpperCase()); }
    catch (e) {
        document.body.innerHTML = `<main class="landing"><h1>Session not available</h1><p class="lede"></p><a class="btn primary" href="join.html">Join a session</a></main>`;
        document.querySelector(".lede").textContent = e.message;
        throw e;
    }
}
const source = S ? "session" : params.has("random") ? "random" : params.has("c") ? "custom" : "file";
const scenarioId = params.get("s") || "cls1-leg-hemorrhage";
const randomSeed = () => Math.floor(Math.random() * 1e9);
const [data, meds, scn] = await Promise.all([
    fetch("../data/acm-1.4.8.json").then((r) => r.json()),
    fetch("../data/medications-1.4.8.json").then((r) => r.json()),
    source === "session" ? S.scn
        : source === "random" ? randomScenario({ severity: params.get("sev"), cause: params.get("cause"), role: params.get("role") || "medic", seed: params.has("seed") ? Number(params.get("seed")) : randomSeed() })
        : source === "custom" ? getCustom(params.get("c"))
        : fetch(`../scenarios/${encodeURIComponent(scenarioId)}.json`).then((r) => r.json()),
]);
if (!scn) {
    document.body.innerHTML = '<main class="landing"><h1>Scenario not found</h1><p class="lede">This custom scenario is not saved in this browser. Open the scenario editor to import it.</p><a class="btn primary" href="editor.html">Scenario editor</a> <a class="btn" href="index.html">Scenarios</a></main>';
    throw new Error("Scenario not found");
}
const guidanceRules = await fetch("../rules/guidance.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
const rubric = scn.rubric ? await fetch(`../${scn.rubric}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : source === "file" ? null : GENERIC_RUBRIC;
let sessionCtl = null; // set when attached to an instructor-led session
const catalogue = buildCatalogue(data);
const seed = S ? S.seed : params.has("seed") ? Number(params.get("seed")) : scn.seed;
/** URL of this scenario with another seed (retry, new variation). */
function scenarioUrl(s) {
    const q = new URLSearchParams();
    if (source === "random") for (const k of ["random", "sev", "cause", "role"]) { if (params.has(k)) q.set(k, params.get(k)); }
    else if (source === "custom") q.set("c", params.get("c"));
    else q.set("s", scn.id);
    q.set("seed", String(s));
    return "play.html?" + q;
}

let sim, ctx, state, body, recorder, ambient;

function start() {
    sim = loadScenario(scn, data, meds, { seed });
    ctx = { sim, level: ROLE_LEVEL[scn.role || "anyone"], inventory: { ...(scn.loadout || {}) }, name: "You", patientName: "Patient", busy: null };
    state = {
        part: "head", cat: "examine", speed: 1, acc: 0, last: performance.now(), running: false, ended: false,
        progress: null, cont: null, history: [], activity: [], quick: [], timeline: [], nextBeat: 0, pulseDone: true, frames: [],
        hints: 0, hintsMax: 0, guidanceKey: "",
    };
    sim.on(onSimEvent);
    recorder = createRecorder(sim);
    ambient = aedAmbient(sim, () => (state.running ? state.speed : 0));
    record();
}

// ------------------------------------------------------------------ events and logs
function log(kind, text) {
    if (!text) return;
    const entry = { t: sim.p.t, text };
    (kind === "quick" ? state.quick : state.activity).unshift(entry);
    state.timeline.push({ t: sim.p.t, text, kind });
}
function onSimEvent(e) {
    if (e.event === "aedSound") { audio.play(e.name, e.name.startsWith("shock") ? 0.9 : 0.8); return; }
    if (e.event === "overdose") state.timeline.push({ t: e.t, text: `Overdose (${e.name})`, kind: "event" });
    const cue = {
        vomit: e.obstructs ? "You hear the casualty vomiting" : "The casualty vomits (recovery position keeps the airway clear)",
        unconscious: "The casualty goes unconscious",
        wokeUp: "The casualty wakes up",
        death: "The casualty has died",
        tensionPneumothorax: null, cardiacArrest: null, rosc: null,
    };
    if (e.event in cue) {
        state.timeline.push({ t: e.t, text: eventName(e), kind: "event" });
        if (cue[e.event]) hint([cue[e.event]]);
        if (e.event === "vomit") audio.play(`vomit${1 + Math.floor(Math.random() * 6)}`, 0.9);
    } else if (["pneumothorax", "hemothorax", "criticalGrace", "rhythmChange", "bagEmpty", "hemolyticReaction", "chestTubeUnsealed"].includes(e.event)) {
        state.timeline.push({ t: e.t, text: eventName(e), kind: "event" });
    }
}
function eventName(e) {
    return {
        vomit: "Vomited" + (e.obstructs ? " (airway obstructed)" : ""), unconscious: "Went unconscious", wokeUp: "Woke up",
        death: `Died (${e.cause})`, tensionPneumothorax: "Tension pneumothorax", cardiacArrest: "Cardiac arrest", rosc: "Return of circulation",
        pneumothorax: `Pneumothorax level ${e.level}${e.tension ? " (tension)" : ""}`, hemothorax: `Hemothorax level ${e.level}`,
        criticalGrace: "Critical vitals (grace period)", rhythmChange: `Rhythm: ${e.rhythm}`, bagEmpty: "IV bag empty",
        hemolyticReaction: "Hemolytic reaction (incompatible blood)", chestTubeUnsealed: "Chest tube unsealed",
    }[e.event] || e.event;
}

let hintTimer = 0;
function hint(lines) {
    const h = $("hint");
    h.textContent = "";
    lines.forEach((l, i) => { if (i) h.append(el("br")); h.append(l); });
    h.classList.add("show");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => h.classList.remove("show"), 2600 + 600 * lines.length);
}

// ------------------------------------------------------------------ actions
function startAction(a) {
    if (state.ended || state.progress) return;
    const part = state.part;
    const why = available(ctx, a, part);
    if (why) { hint([why]); return; }
    const t = actionTime(ctx, a, part);
    if (a.continuous || t < 0.1) { finishAction(a, part, pickItem(ctx, a)); return; }
    state.progress = { a, part, item: pickItem(ctx, a), total: t, start: sim.p.t + state.acc, end: sim.p.t + state.acc + t };
    $("progressLabel").textContent = `${a.label}…`;
    $("progress").classList.add("show");
    if (!state.running) setSpeed(state.speed || 1);
}
/** A timed step that is not a menu action (transfusion menu add/remove). */
function startTimed(label, seconds, fn) {
    if (state.ended || state.progress) return;
    state.progress = { fn, label, total: seconds, start: sim.p.t + state.acc, end: sim.p.t + state.acc + seconds };
    $("progressLabel").textContent = label;
    $("progress").classList.add("show");
}
function cancelAction(reason) {
    if (!state.progress) return;
    state.progress = null;
    $("progress").classList.remove("show");
    if (reason) hint([reason]);
}
function finishAction(a, part, item) {
    ctx.label = a.label;
    const r = a.run(ctx, part) || {};
    if (item && a.consumes && !r.refund) ctx.inventory[item] = Math.max(0, (ctx.inventory[item] || 0) - 1);
    if (a.returnsItem) ctx.inventory[a.returnsItem] = (ctx.inventory[a.returnsItem] || 0) + 1;
    for (const c of r.give || []) ctx.inventory[c] = (ctx.inventory[c] || 0) + 1;
    if (!r.refund) markTreated(sim, a);
    recorder.action(a.id, part, !r.refund);
    if (a.id === "applytourniquet") audio.play("tourniquet_apply", 0.8);
    if (a.id === "removetourniquet") audio.play("tourniquet_remove", 0.8);
    if (r.hint) hint(r.hint);
    if (r.log) log("activity", r.log);
    if (r.quick) log("quick", r.quick);
    if (a.continuous) beginContinuous(a.continuous, part, r.window);
    render();
}

/** Syringe window steps: Draw (4 s) keeps the filled syringe; Push/Inject (2.5 s) draws and gives it at once. */
function syringeCallbacks(part, size) {
    // As in ACM (Syringe_Draw_Button): every button starts an ACE progress bar, which closes the dialog (closeDialog 0).
    // Draw fills the syringe at the end of 4 s; push it later from the Medication menu. Push/Inject fill it at once,
    // then give it after 2.5 s (cancelled, the filled syringe stays in your inventory).
    return {
        draw(drug, ml) {
            endContinuous();
            startTimed(`Drawing ${drugName(drug)}...`, 4, () => {
                const r = drawSyringe(ctx, size, drug, ml);
                recorder.action("drawsyringe", part, r.ok, { drug, size, ml });
                if (r.ok) { hint(r.hint); log("activity", `${ctx.name} drew ${drugName(drug)} into a ${size}ml syringe`); }
                render();
            });
        },
        inject(drug, ml, iv) {
            const d = drawSyringe(ctx, size, drug, ml);
            endContinuous();
            if (!d.ok) { render(); return; }
            recorder.action("drawsyringe", part, true, { drug, size, ml });
            startTimed(`${iv ? "Pushing" : "Injecting"} ${drugName(drug)}...`, 2.5, () => {
                const r = injectSyringe(sim, ctx, part, d.syringe, iv);
                recorder.action(`${drug.toLowerCase()}_${size}_${iv ? "iv" : "im"}`, part, r.ok);
                if (r.hint) hint(r.hint);
                if (r.ok) log("activity", `${ctx.name} ${r.log}`);
                render();
            });
        },
    };
}
/** AED monitor buttons. */
function aedPress(id) {
    const a = aedState(sim.p);
    if (id === "cpr") { a.mutedCPR = !a.mutedCPR; hint([a.mutedCPR ? "CPR metronome off" : "CPR metronome on"]); return; }
    if (id === "alarms") { a.mutedAlarm = !a.mutedAlarm; hint([a.mutedAlarm ? "Alarms muted" : "Alarms on"]); return; }
    const map = { analyze: ["aed_analyzerhythm", "body"], charge: ["aed_manualcharge", "body"], shock: ["aed_shock", "body"], speeddial: ["aed_cancelcharge", "body"], nibp: ["aed_measurebp", "body"] };
    const [actionId, part] = map[id];
    const act = catalogue.find((x) => x.id === actionId);
    const why = available(ctx, act, part);
    if (why) { if (id !== "speeddial") hint([why === "Condition not met" ? "Not available now" : why]); return; }
    finishAction(act, part, null);
}

function beginContinuous(type, part, win) {
    state.cont = { type, part, nextSqueeze: sim.p.t + 6 };
    ctx.busy = type;
    if (win && ["bp", "stethoscope", "transfusion", "syringe", "aed", "cric"].includes(type)) {
        const host = $("procHost");
        const speed = () => (state.running ? state.speed : 0);
        if (type === "bp") state.cont.win = openBP(host, sim, part, win.stethoscope, speed);
        if (type === "stethoscope") state.cont.win = openStethoscope(host, sim, speed);
        if (type === "transfusion") state.cont.win = openTransfusion(host, sim, part, ctx, { startTimed, onChange: (text) => { log("activity", text); render(); } });
        if (type === "syringe") state.cont.win = openSyringe(host, ctx, part, win.size, syringeCallbacks(part, win.size));
        if (type === "aed") state.cont.win = openAED(host, sim, { press: aedPress }, speed);
        if (type === "cric") state.cont.win = openCric(host, sim, { hint, close: () => endContinuous() });
        $("procClose").textContent = { bp: "Stop measuring", stethoscope: "Stop using stethoscope", transfusion: "Close", syringe: "Close", aed: "Close monitor", cric: "Finish / cancel" }[type];
        $("procWindow").classList.add("show");
        return;
    }
    const label = $("continuousLabel"), btns = $("continuousButtons");
    btns.textContent = "";
    const b = (text, fn, cls = "btn") => { const x = el("button", { className: cls, textContent: text }); x.addEventListener("click", fn); btns.append(x); return x; };
    if (type === "pulse") {
        $("pulseWindow").classList.add("show");
        $("continuous").classList.remove("show");
        return;
    }
    if (type === "headTilt") { label.textContent = "Holding head tilt-chin lift"; b("Release", endContinuous); }
    if (type === "bvm") { label.textContent = "Ventilating with BVM (one squeeze every 6 s)"; b("Stop", endContinuous); }
    if (type === "cpr") {
        label.textContent = "CPR in progress";
        const pause = b("Pause", () => {
            if (sim.p.cpr) { sim.act("cprPause"); pause.textContent = "Continue"; label.textContent = "CPR paused"; log("activity", "You paused CPR"); }
            else { sim.act("cprResume"); pause.textContent = "Pause"; label.textContent = "CPR in progress"; log("activity", "You continued CPR"); }
            render();
        });
        b("Stop", endContinuous, "btn danger");
    }
    $("continuous").classList.add("show");
}
function endContinuous() {
    const c = state.cont;
    if (!c) return;
    if (c.type === "pulse") { $("pulseWindow").classList.remove("show"); hint(["Stopped feeling pulse"]); }
    if (c.win) { c.win.close(); $("procWindow").classList.remove("show"); }
    if (c.type === "bp") hint(["Stopped measuring blood pressure"]);
    if (c.type === "stethoscope") hint(["Stopped using stethoscope"]);
    if (c.type === "cric") {
        const r = endProcedure(sim);
        if (r.kitReturned) { ctx.inventory.ACM_CricKit = (ctx.inventory.ACM_CricKit || 0) + 1; hint(["Cancelled surgical airway"]); }
        else if (r.failed) { hint(["Surgical airway failed"]); log("activity", `${ctx.name} cancelled surgical airway`); }
        else if (r.cancelled) { hint(["Cancelled surgical airway"]); log("activity", `${ctx.name} cancelled surgical airway`); }
        else if (r.established) { log("activity", `${ctx.name} established surgical airway`); recorder.action("surgicalairway_established", "head", true); if (sim.p.sa.strapSecure) recorder.action("surgicalairway_securestrap", "head", true); }
    }
    if (c.type === "headTilt") { sim.p.headTilt = false; log("activity", "You released head tilt-chin lift"); }
    if (c.type === "bvm") { sim.act("bvmStop"); log("activity", "You stopped using BVM"); }
    if (c.type === "cpr") { sim.act("cprStop"); log("activity", "You stopped CPR"); }
    state.cont = null;
    ctx.busy = null;
    $("continuous").classList.remove("show");
    render();
}

// ------------------------------------------------------------------ time
function setSpeed(s) {
    state.speed = s;
    state.running = s > 0 && !state.ended;
    for (const btn of $("speed").querySelectorAll("button")) btn.setAttribute("aria-pressed", String(Number(btn.dataset.speed) === s));
}
function record() {
    const p = sim.p;
    state.history.push({ t: p.t, bv: p.bloodVolume, spo2: p.spo2, hr: p.hr, map: p.bp[0] + (p.bp[1] - p.bp[0]) / 3 });
    pushFrame(state.frames, captureFrame(sim));
}
function step() {
    sim.tick();
    runTimeline(sim);
    updatePulseOximeters(sim);
    const p = sim.p, c = state.cont;
    if (c) {
        if (c.type === "bvm" && p.t >= c.nextSqueeze) { sim.act("bvmBreath"); audio.play("bvm_squeeze", 0.6); c.nextSqueeze = p.t + 6; }
        // Continuous actions end on their own as in game: patient wakes (head tilt, BVM, CPR) or dies
        if ((c.type === "headTilt" && (!p.headTilt || !p.unconscious)) || (c.type === "bvm" && (!p.bvm || (!p.unconscious && !p.lying))) || (c.type === "cpr" && !p.unconscious)) endContinuous();
        if (!p.alive && c.type !== "pulse") endContinuous();
        if (c.type === "cric" && state.cont && (!p.unconscious || p.sa?.failed)) endContinuous();
    }
    if (state.progress?.fn) {
        const pr = state.progress;
        if (p.t >= pr.end) { state.progress = null; $("progress").classList.remove("show"); pr.fn(); render(); }
    } else if (state.progress) {
        const pr = state.progress;
        const why = available(ctx, pr.a, pr.part);
        if (why && !why.startsWith("Requires")) cancelAction(`${pr.a.label} interrupted`);
        else if (p.t >= pr.end) { state.progress = null; $("progress").classList.remove("show"); finishAction(pr.a, pr.part, pr.item); }
    }
    record();
    recorder.tick();
    if (!p.alive) { endScenario("The casualty died."); return; }
    if (p.t >= scn.timeLimit) endScenario("Time is up: the casualty has been handed over.");
}
function frame(now) {
    const dt = Math.min(0.25, (now - state.last) / 1000);
    state.last = now;
    if (state.running) {
        state.acc += dt * state.speed;
        let steps = 0;
        while (state.acc >= 1 && !state.ended && steps < 20) { state.acc -= 1; step(); steps++; if (!state.ended) renderTick(); }
    }
    drawFrame(now);
    if (!state.ended) ambient(now);
    requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ rendering
function renderCats() {
    const cats = $("cats");
    cats.textContent = "";
    for (const c of CATEGORIES) {
        if (c.cbrnOnly && !sim.p.cbrn) continue;
        const b = el("button", { role: "tab", title: c.label });
        b.innerHTML = CAT_ICONS[c.id];
        b.append(el("span", { textContent: c.label.split(" ")[0] }));
        b.setAttribute("aria-selected", String(c.id === state.cat));
        b.addEventListener("click", () => { state.cat = c.id; render(); });
        cats.append(b);
    }
    $("catTitle").textContent = CATEGORIES.find((c) => c.id === state.cat).label;
}
function renderActions() {
    const list = $("actions");
    list.textContent = "";
    const showAll = $("showUnavailable").checked;
    let shown = 0;
    for (const a of catalogue.filter((x) => x.category === state.cat)) {
        if (!a.parts.includes(state.part)) continue;
        const why = available(ctx, a, state.part);
        if (why && !showAll) continue;
        const b = el("button", { disabled: !!why || !!state.progress });
        b.append(el("span", { textContent: a.label }));
        if (why) b.append(el("span", { className: "why", textContent: why }));
        else if (a.items.length) {
            const n = a.items.reduce((s, i) => s + (ctx.inventory[i] || 0), 0);
            b.append(el("span", { className: "count", textContent: `×${n}` }));
        }
        b.addEventListener("click", () => startAction(a));
        list.append(el("li", {}, b));
        shown++;
    }
    if (!shown) list.append(el("li", { className: "none", textContent: "No actions available on this body part" }));
}
function renderState() {
    const p = sim.p, box = $("patientState");
    box.textContent = "";
    const chip = (t, warn) => box.append(el("span", { className: "chip" + (warn ? " warn" : ""), textContent: t }));
    chip(PART_NAMES[state.part] + " selected");
    if (!p.alive) chip("Dead", true);
    else if (p.unconscious) chip("Unconscious", true);
    else chip("Conscious");
    if (p.recoveryPosition) chip("Recovery position");
    if (p.bvm) chip("BVM");
    if (p.cpr || p.cprPaused) chip(p.cpr ? "CPR" : "CPR paused");
    if (p.cbrn) {
        if (p.cbrn.inCloud) chip("In chemical cloud", true);
        if (p.cbrn.ppe.mask) chip(p.cbrn.ppe.filter > 0 ? "Gas mask" : "Gas mask (filter spent)", p.cbrn.ppe.filter <= 0);
        if (p.cbrn.ppe.suit) chip("CBRN suit");
    }
}
function renderInjuries() {
    const ul = $("injuries");
    ul.textContent = "";
    for (const e of injuryList(sim, state.part)) {
        const li = el("li", { textContent: e.text || " " });
        li.style.color = e.color;
        ul.append(li);
    }
}
function renderLogs() {
    for (const [id, arr] of [["activity", state.activity], ["quick", state.quick]]) {
        const ul = $(id);
        ul.textContent = "";
        for (const e of arr.slice(0, 60)) ul.append(el("li", {}, el("time", { textContent: formatTime(e.t) }), e.text));
    }
}
function renderInventory() {
    const ul = $("inventory");
    ul.textContent = "";
    for (const [cls, n] of Object.entries(ctx.inventory)) {
        ul.append(el("li", { className: n ? "" : "out" }, el("span", { textContent: itemName(data, cls) }), el("span", { textContent: `×${n}` })));
    }
    for (const sy of ctx.syringes || []) ul.append(el("li", {}, el("span", { textContent: `Syringe ${sy.size}ml: ${drugName(sy.drug)}` }), el("span", { textContent: `${sy.ml.toFixed(1)} ml` })));
}
// ------------------------------------------------------------------ guidance (hints)
let hintPref = 0;
try { hintPref = Number(localStorage.getItem("acmt.hints") || 0); } catch { /* storage blocked */ }
if (params.has("hints")) hintPref = Number(params.get("hints"));
function setHints(depth) {
    state.hints = guidanceRules ? Math.max(0, Math.min(3, depth)) : 0;
    if (!state.ended) state.hintsMax = Math.max(state.hintsMax, state.hints);
    $("hintsSel").value = String(state.hints);
    $("rightCol").classList.toggle("with-guidance", state.hints > 0);
    state.guidanceKey = "";
    try { localStorage.setItem("acmt.hints", String(state.hints)); } catch { /* storage blocked */ }
    renderGuidance();
}
function renderGuidance() {
    if (!state.hints) return;
    const items = evaluateGuidance(guidanceRules, sim, { depth: state.hints, level: ctx.level }).slice(0, 4);
    const key = state.hints + "|" + items.map((i) => i.id + i.text).join("|");
    if (key === state.guidanceKey) return;
    state.guidanceKey = key;
    $("guidanceTitle").textContent = `Guidance · ${DEPTHS[state.hints]}`;
    const ul = $("guidance");
    ul.textContent = "";
    for (const it of items) {
        const li = el("li", { className: it.priority < 10 ? "urgent" : it.priority < 40 ? "soon" : "" }, el("span", { className: "gtext", textContent: it.text }));
        if (it.guide) li.append(el("span", { className: "gguide", textContent: `Guide: ${it.guide}` }));
        ul.append(li);
    }
    if (!items.length) ul.append(el("li", { className: "none", textContent: "Nothing urgent found. Keep reassessing." }));
}

function render() {
    renderCats();
    renderActions();
    renderTick();
}
function renderTick() {
    $("clock").textContent = formatTime(sim.p.t);
    renderState();
    body.update(bodyPartColors(sim), state.part, Object.assign(Object.create(sim.p), { splintBone: sim.aceSetting("fractures", 1) >= 2 }));
    renderInjuries();
    renderLogs();
    renderInventory();
    renderGuidance();
    if (!state.progress) renderActions();
}
function drawFrame(now) {
    if (state.progress) {
        const pr = state.progress;
        const f = Math.min(1, (sim.p.t + state.acc - pr.start) / pr.total);
        $("progressFill").style.width = `${f * 100}%`;
        $("progress").setAttribute("aria-valuenow", String(Math.round(f * 100)));
    }
    if (state.cont?.type === "pulse") drawPulse(now);
}
function drawPulse(now) {
    const part = state.cont.part;
    const r = feelPulse(sim, part);
    $("pulseSite").textContent = `Patient (${r.site[0].toUpperCase() + r.site.slice(1)})`;
    const heart = $("heart");
    if (r.rate > 0 && state.running) {
        heart.style.visibility = "visible";
        $("pulseNothing").textContent = "";
        if (now >= state.nextBeat) {
            const delay = 60 / r.rate / state.speed;
            const beat = Math.min(0.5, 0.4 * delay), release = Math.min(0.7, 0.6 * delay);
            const full = r.strength, rel = full * 0.62;
            heart.animate([{ transform: `scale(${rel})` }, { transform: `scale(${full})`, offset: beat / (beat + release) }, { transform: `scale(${rel})` }], { duration: (beat + release) * 1000, easing: "ease-out" });
            state.nextBeat = now + delay * 1000;
        }
    } else {
        heart.style.visibility = r.rate > 0 ? "visible" : "hidden";
        $("pulseNothing").textContent = r.rate > 0 ? "" : "Nothing felt";
    }
}

// ------------------------------------------------------------------ briefing and debrief
function briefing() {
    $("briefTitle").textContent = `${scn.module}: ${scn.title}`;
    $("briefSummary").textContent = scn.summary;
    const ul = $("briefObjectives");
    ul.textContent = "";
    for (const o of scn.objectives || []) ul.append(el("li", { textContent: o }));
    $("briefKit").textContent = Object.entries(scn.loadout || {}).map(([c, n]) => `${n}× ${itemName(data, c)}`).join(", ") + `. Role: ${scn.role}. Time limit ${Math.round(scn.timeLimit / 60)} min.`;
    $("briefing").classList.add("show");
    $("startBtn").focus();
}
function endScenario(reason) {
    if (state.ended) return;
    state.ended = true;
    setSpeed(0);
    cancelAction();
    if (state.cont) endContinuous();
    pushFrame(state.frames, captureFrame(sim));
    debrief(reason);
}
function chart(series, key, label, lo, hi, color, marks = [], ticks = []) {
    const W = 760, H = 160, L = 34, B = 20, T = 8;
    const tMax = Math.max(60, state.history.at(-1).t);
    const x = (t) => L + (t / tMax) * (W - L - 6);
    const y = (v) => T + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (H - T - B);
    const pts = series.map((h) => `${x(h.t).toFixed(1)},${y(h[key]).toFixed(1)}`).join(" ");
    const markLines = marks.map((m) => `<line x1="${L}" x2="${W - 6}" y1="${y(m.v)}" y2="${y(m.v)}" stroke="${m.c}" stroke-dasharray="4 4" stroke-width="1"/><text x="${W - 8}" y="${y(m.v) - 3}" text-anchor="end">${m.t}</text>`).join("");
    const tickLines = ticks.map((k) => `<line x1="${x(k.t)}" x2="${x(k.t)}" y1="${T}" y2="${H - B}" class="tick"><title>${formatTime(k.t)} ${k.label}</title></line>`).join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label} over time">${tickLines}
        <line class="axis" x1="${L}" y1="${H - B}" x2="${W - 6}" y2="${H - B}"/><line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}"/>
        <text x="${L - 4}" y="${T + 8}" text-anchor="end">${hi}</text><text x="${L - 4}" y="${H - B}" text-anchor="end">${lo}</text>
        <text x="${L}" y="${H - 4}">0:00</text><text x="${W - 6}" y="${H - 4}" text-anchor="end">${formatTime(tMax)}</text>
        <text x="${L + 6}" y="${T + 10}">${label}</text>${markLines}
        <polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"/></svg>`;
}
function debrief(reason) {
    const p = sim.p;
    const box = $("debriefBody");
    const firsts = {};
    for (const a of sim.actions) if (!(a.name in firsts)) firsts[a.name] = a.t;
    const outcome = p.alive ? (p.woundBleeding > 0 ? "Alive, still bleeding" : "Alive") : `Died: ${p.causeOfDeath}`;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const res = rubric ? scoreRun(rubric, sim, recorder) : null;
    const record = { ...makeRecord(scn, seed, sim, res), hints: DEPTHS[state.hintsMax] };
    const replay = { key: record.date, title: `${scn.module}: ${scn.title}`, seed, date: record.date, frames: state.frames, timeline: state.timeline.slice() };
    const saved = addRecord({ ...record, replay: addReplay(replay) ? replay.key : null, session: sessionCode || undefined });
    sessionCtl?.finish(record);
    saveCloudHistory(record);
    const icon = { pass: "✓", fail: "✗", na: "–" };
    const scoreHtml = res ? `
        <div class="scorecard ${res.passed ? "go" : "nogo"}">
            <div class="verdict">${res.passed ? "GO" : "NO-GO"}</div>
            <div><div class="pct">${Math.round(res.score * 100)} %</div><div class="muted">pass mark ${Math.round(res.passMark * 100)} %${res.criticalFails.length ? ` · ${res.criticalFails.length} critical check${res.criticalFails.length > 1 ? "s" : ""} failed` : ""}${rubric.generic ? " · general checks (random and custom scenarios)" : ""}</div></div>
        </div>
        <h3>Checks</h3>
        <ul class="checks">${res.results.map((r) => `<li class="${r.status}">
            <span class="ic" aria-label="${r.status}">${icon[r.status]}</span>
            <div><div class="ct">${esc(r.check.text)}${r.check.critical ? ' <span class="crit">critical</span>' : ""} <span class="cw">×${r.check.weight ?? 1}</span></div>
            <div class="cd">${esc(r.detail)}</div>
            ${r.status === "fail" ? `<div class="why">${esc(r.check.why || "")}${r.check.guide ? ` <span class="guide">Guide: ${esc(r.check.guide)}</span>` : ""}</div>` : ""}</div></li>`).join("")}</ul>` : "";
    const ticks = (sim.menuLog || []).filter((e) => e.ok).map((e) => ({ t: e.t, label: catalogue.find((a) => a.id === e.id)?.label || e.id }));
    box.innerHTML = `
        <h2 id="debriefTitle">Debrief: ${esc(scn.title)}</h2>
        <p>${esc(reason)}</p>
        <div class="outcome ${p.alive ? "alive" : "dead"}">${esc(outcome)}</div>
        ${state.hintsMax ? `<p class="muted">Hints were on during this run (up to ${DEPTHS[state.hintsMax]}).</p>` : ""}
        ${scoreHtml}
        <h3>Patient at the end (true values)</h3>
        <table class="vitals-table"><tr><th>Blood volume</th><td>${p.bloodVolume.toFixed(2)} L</td><th>Heart rate</th><td>${Math.round(p.hr)}</td></tr>
        <tr><th>Blood pressure</th><td>${p.bp[1]}/${p.bp[0]}</td><th>SpO2</th><td>${p.spo2.toFixed(1)} %</td></tr>
        <tr><th>Respiration</th><td>${Math.round(p.rr)} /min</td><th>Conscious</th><td>${p.alive && !p.unconscious ? "yes" : "no"}</td></tr></table>
        <h3>Blood volume and oxygen</h3>
        ${chart(state.history, "bv", "Blood volume (L)", 2.5, 6, "#e0574f", [{ v: 5.1, t: "5.1 L: can wake", c: "#c9a227" }, { v: 3.6, t: "3.6 L: class IV", c: "#e0574f" }], ticks)}
        ${chart(state.history, "spo2", "SpO2 (%)", 50, 100, "#4dcccc", [{ v: 80, t: "80 %: unconscious", c: "#c9a227" }, { v: 67, t: "67 %: hypoxic arrest", c: "#e0574f" }], ticks)}
        <p class="muted">Grey lines mark your treatments (hover for details).</p>
        <h3>Timeline</h3>
        <ul class="timeline">${state.timeline.sort((a, b) => a.t - b.t).map((e) => `<li class="${e.kind === "event" ? "ev" : ""}"><time>${formatTime(e.t)}</time>${esc(e.text)}</li>`).join("") || "<li>No actions taken</li>"}</ul>

        <p class="muted">${saved ? 'Saved to <a href="records.html">your records</a> in this browser.' : storageOK ? "Could not save this run: browser storage is full." : "This browser blocks storage, so the run is not saved."}</p>
        ${S ? '<p class="muted">Your result has been sent to the instructor. Stay on this page: it reloads when the instructor starts the next round.</p>' : ""}
        <div class="buttons"><a class="btn" href="index.html">Scenarios</a><button class="btn" id="replayBtn">Replay</button>${S ? "" : '<button class="btn" id="retryBtn">Retry</button><button class="btn primary" id="newSeedBtn">New variation</button>'}</div>`;
    $("debrief").classList.add("show");
    $("replayBtn").addEventListener("click", () => openReplayModal(replay));
    $("retryBtn")?.addEventListener("click", () => { location.href = scenarioUrl(seed); });
    $("newSeedBtn")?.addEventListener("click", () => { location.href = scenarioUrl(randomSeed()); });
    ($("retryBtn") || $("replayBtn")).focus({ preventScroll: true });
    box.scrollTop = 0;
}

function openReplayModal(replay) {
    $("debrief").classList.remove("show");
    $("replayTitle").textContent = `Replay: ${replay.title}`;
    const view = mountReplay($("replayHost"), replay);
    $("replay").classList.add("show");
    $("replayClose").onclick = () => { view.destroy(); $("replay").classList.remove("show"); $("debrief").classList.add("show"); };
}

// ------------------------------------------------------------------ wiring
start();
document.title = `${scn.title}: ACM Trainer`;
$("title").innerHTML = "";
$("title").append(scn.title, el("small", { textContent: S ? `Session ${S.code} · ${S.run.name}` : scn.module + (source === "random" ? ` · seed ${seed}` : seed !== scn.seed ? ` · variation ${seed}` : "") }));
body = createBody($("body"), (part) => { state.part = part; render(); });
let clockLocked = false;
$("speed").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && !state.ended && !clockLocked) setSpeed(Number(b.dataset.speed)); });
$("showUnavailable").addEventListener("change", render);
$("cancelBtn").addEventListener("click", () => cancelAction("Cancelled"));
$("pulseStop").addEventListener("click", endContinuous);
$("procClose").addEventListener("click", endContinuous);
$("soundToggle").addEventListener("change", (e) => { audio.enabled = e.target.checked; });
$("hintsSel").addEventListener("change", (e) => setHints(Number(e.target.value)));
if (!guidanceRules) $("hintsSel").disabled = true;
$("endBtn").addEventListener("click", () => endScenario("You ended the scenario."));
$("startBtn").addEventListener("click", () => {
    if (S && !sessionCtl?.canStart()) return;
    $("briefing").classList.remove("show");
    if (S) { sessionApi.onStart?.(); if (!clockLocked) setSpeed(1); } else setSpeed(1);
});
document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.target.closest("button, input, a, [role=button]") && !clockLocked) { e.preventDefault(); setSpeed(state.speed > 0 ? 0 : 1); }
    if (e.key === "Escape" && state.progress) cancelAction("Cancelled");
});
setSpeed(0);
setHints(hintPref);
render();
if (params.has("autostart")) {
    // Testing aid: skip the briefing, optionally fast-forward (ff seconds) and select a part
    // script=id@part,id@part runs actions through the same path as the buttons (startAction -> progress -> finish)
    for (const entry of (params.get("script") || "").split(",").filter(Boolean)) {
        const [id, part] = entry.split("@");
        state.part = part;
        startAction(catalogue.find((a) => a.id === id));
        for (let i = 0; i < 60 && state.progress && !state.ended; i++) step();
    }
    for (let i = 0; i < Number(params.get("ff") || 0) && !state.ended; i++) step();
    if (params.get("part")) state.part = params.get("part");
    if (params.get("cat")) state.cat = params.get("cat");
    render();
    if (!state.ended) setSpeed(1);
    else if (params.has("openreplay")) $("replayBtn").click();
} else briefing();
/** Saved history (design 5.2): kept in Firestore for Discord-signed-in users; Firebase loads only for them. */
async function saveCloudHistory(record) {
    if (S) return;
    let name = "";
    try { name = localStorage.getItem("acmt.discordName") || ""; } catch { /* storage blocked */ }
    if (!name) return;
    try {
        const c = await import("./cloud.js");
        const u = await c.ready;
        if (c.isDiscord(u)) await c.addDoc(c.collection(c.db, "history", u.uid, "runs"), { ...record, uid: u.uid, at: c.serverTimestamp() });
    } catch { /* offline: the local record is still there */ }
}

// ------------------------------------------------------------------ instructor-led session
let noticeTimer = 0;
function notice(text) {
    const n = $("notice");
    n.textContent = text;
    n.classList.add("show");
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => n.classList.remove("show"), 8000);
}
const sessionApi = {
    getSim: () => sim, getState: () => state, recorder: null,
    setClock: (s) => { if (!state.ended) setSpeed(s); },
    lockClock: (on) => {
        clockLocked = on;
        for (const b of $("speed").querySelectorAll("button")) b.disabled = on;
        $("speed").title = on ? "The instructor controls the clock" : "";
    },
    enableStart: (on) => {
        $("startBtn").disabled = !on;
        $("startBtn").textContent = on ? "Start" : "Waiting for the instructor…";
    },
    autoStart: () => { $("briefing").classList.remove("show"); },
    end: (reason) => endScenario(reason),
    notice,
    timeline: (text) => { state.timeline.push({ t: sim.p.t, text, kind: "event" }); },
    limitHints: (depth) => {
        for (const o of $("hintsSel").options) o.disabled = Number(o.value) > depth;
        if (state.hints > depth) setHints(depth);
        if (depth === 0) $("hintsSel").title = "Hints are off in this session";
    },
    currentAction: () => state.progress?.a?.label || state.progress?.label || (state.cont ? state.cont.type : null),
};
if (S) {
    sessionApi.recorder = recorder;
    $("endBtn").hidden = true; // the instructor ends the scenario
    sessionApi.enableStart(false);
    sessionCtl = S.attach(sessionApi);
}
requestAnimationFrame((t) => { state.last = t; frame(t); });
