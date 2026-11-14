// Scenario editor: builds a scenario object (docs/TRAINER-design.md section 4), validates it, previews the casualty
// with the real engine, saves it in this browser and exports/imports it as a JSON file.
import { loadScenario } from "../../engine/scenario.js";
import { buildCatalogue } from "../../engine/menu.js";
import { injuryList, formatTime, PART_NAMES } from "../../engine/injuryList.js";
import { BODY_PARTS } from "../../engine/util.js";
import { knownItems, validateScenario, ROLE_LOADOUT, MECHANISMS, MECHANISM_NAMES, BLOOD_TYPES } from "../../engine/custom.js";
import { loadCustom, getCustom, saveCustom, deleteCustom, newCustomId, download, storageOK } from "./store.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };

const [data, meds, index] = await Promise.all([
    fetch("../data/acm-1.4.8.json").then((r) => r.json()),
    fetch("../data/medications-1.4.8.json").then((r) => r.json()),
    fetch("../scenarios/index.json").then((r) => r.json()),
]);
const builtIn = await Promise.all(index.scenarios.map((id) => fetch(`../scenarios/${id}.json`).then((r) => r.json())));
const items = knownItems(data, buildCatalogue(data));
const WOUND_TYPES = Object.keys(data.wounds.types).filter((t) => !t.startsWith("_"));
const params = new URLSearchParams(location.search);
let currentId = null;

for (const b of BLOOD_TYPES) $("bloodType").append(el("option", { value: b, textContent: b, selected: b === "O+" }));

function fillStartFrom() {
    const sel = $("startFrom");
    sel.length = 1;
    const mine = Object.values(loadCustom());
    if (mine.length) sel.append(el("optgroup", { label: "Your scenarios" }, ...mine.map((s) => el("option", { value: "c:" + s.id, textContent: s.title }))));
    sel.append(el("optgroup", { label: "Built-in (makes a copy)" }, ...builtIn.map((s) => el("option", { value: "b:" + s.id, textContent: `${s.module}: ${s.title}` }))));
}

// ------------------------------------------------------------------ rows
function injuryRow(w = { part: "leftleg", mechanism: "bullet", damage: 1 }) {
    const part = el("select", {}, ...BODY_PARTS.map((p) => el("option", { value: p, textContent: PART_NAMES[p], selected: p === w.part })));
    const kind = el("select", {},
        el("optgroup", { label: "Mechanism (rolls wounds)" }, ...MECHANISMS.map((m) => el("option", { value: "m:" + m, textContent: MECHANISM_NAMES[m] || m, selected: w.mechanism === m }))),
        el("optgroup", { label: "Exact wound" }, ...WOUND_TYPES.map((t) => el("option", { value: "w:" + t, textContent: t.replace(/([a-z])([A-Z])/g, "$1 $2"), selected: !w.mechanism && w.type === t }))));
    const dmg = el("input", { type: "number", min: 0.01, max: 20, step: 0.05, value: w.damage });
    const count = el("input", { type: "number", min: 1, max: 10, step: 1, value: w.count || 1 });
    const del = el("button", { type: "button", className: "btn", textContent: "Remove" });
    for (const [c, l] of [[part, "Body part"], [kind, "Mechanism or wound"], [dmg, "Damage"], [count, "Repeat"]]) c.setAttribute("aria-label", l);
    const tr = el("tr", {}, el("td", {}, part), el("td", {}, kind), el("td", {}, dmg), el("td", {}, count), el("td", {}, del));
    del.addEventListener("click", () => tr.remove());
    tr.read = () => {
        const [k, v] = kind.value.split(":");
        const o = { part: part.value, damage: Number(dmg.value) };
        if (k === "m") o.mechanism = v; else o.type = v;
        if (Number(count.value) > 1) o.count = Number(count.value);
        return o;
    };
    $("injuries").tBodies[0].append(tr);
}
function itemRow(cls = items[0].cls, n = 1) {
    const sel = el("select", {}, ...items.map((i) => el("option", { value: i.cls, textContent: i.name, selected: i.cls === cls })));
    const count = el("input", { type: "number", min: 0, max: 99, step: 1, value: n });
    const del = el("button", { type: "button", className: "btn", textContent: "Remove" });
    sel.setAttribute("aria-label", "Item"); count.setAttribute("aria-label", "Count");
    const tr = el("tr", {}, el("td", {}, sel), el("td", {}, count), el("td", {}, del));
    del.addEventListener("click", () => tr.remove());
    tr.read = () => [sel.value, Number(count.value)];
    $("loadout").tBodies[0].append(tr);
}

// ------------------------------------------------------------------ form <-> scenario
function setForm(s) {
    $("title").value = s.title || "";
    $("module").value = s.module && s.module !== "Custom" ? s.module : "";
    $("track").value = s.track || "combat-medic";
    $("role").value = s.role || "medic";
    $("timeLimit").value = Math.round((s.timeLimit || 600) / 60);
    $("seed").value = s.seed ?? 1;
    $("summary").value = s.summary || "";
    $("objectives").value = (s.objectives || []).join("\n");
    $("weight").value = s.patient?.weight ?? 80;
    $("bloodType").value = s.patient?.bloodType ?? "O+";
    $("conscious").checked = s.patient?.conscious !== false;
    $("ptx").value = s.chest?.ptx ?? 0;
    $("htx").value = s.chest?.htx ?? 0;
    $("injuries").tBodies[0].textContent = "";
    for (const w of s.injuries || []) injuryRow(w);
    $("loadout").tBodies[0].textContent = "";
    for (const [c, n] of Object.entries(s.loadout || {})) itemRow(c, n);
    $("deleteBtn").hidden = !currentId;
    $("errors").textContent = "";
    $("preview").hidden = true;
}
function readForm() {
    const s = {
        id: currentId || newCustomId(), custom: true,
        title: $("title").value.trim(), module: $("module").value.trim() || "Custom", track: $("track").value,
        summary: $("summary").value.trim(), seed: Math.trunc(Number($("seed").value) || 1), timeLimit: Math.round(Number($("timeLimit").value) * 60),
        role: $("role").value,
        patient: { weight: Number($("weight").value), bloodType: $("bloodType").value, conscious: $("conscious").checked },
        injuries: [...$("injuries").tBodies[0].rows].map((r) => r.read()),
        loadout: {}, objectives: $("objectives").value.split("\n").map((x) => x.trim()).filter(Boolean),
    };
    const ptx = Math.trunc(Number($("ptx").value) || 0), htx = Math.trunc(Number($("htx").value) || 0);
    if (ptx || htx) s.chest = { ...(ptx ? { ptx } : {}), ...(htx ? { htx } : {}) };
    for (const r of $("loadout").tBodies[0].rows) { const [c, n] = r.read(); s.loadout[c] = (s.loadout[c] || 0) + n; }
    return s;
}
function check() {
    const s = readForm();
    const v = validateScenario(s, data, items);
    const box = $("errors");
    box.textContent = "";
    if (!v.ok) box.append(el("strong", { textContent: "Fix these first:" }), el("ul", {}, ...v.errors.map((e) => el("li", { textContent: e }))));
    return v.ok ? s : null;
}
function status(text) { $("status").textContent = text; }

// ------------------------------------------------------------------ preview
function preview() {
    const s = check();
    if (!s) return;
    const sim = loadScenario(s, data, meds);
    const box = $("previewBody");
    box.textContent = "";
    const list = el("div", { className: "preview-grid" });
    for (const part of BODY_PARTS) {
        const lines = injuryList(sim, part).filter((x) => x.text && x.text !== PART_NAMES[part]);
        const ul = el("ul", { className: "injuries" });
        for (const l of lines) { const li = el("li", { textContent: l.text }); li.style.color = l.color; ul.append(li); }
        list.append(el("div", { className: "panel" }, el("h2", { textContent: PART_NAMES[part] }), ul));
    }
    const p = sim.p;
    const facts = [`External bleeding ${(p.woundBleeding * 1000).toFixed(0)} ml/min`, `internal bleeding ${(p.internalBleeding * 1000).toFixed(0)} ml/min`,
        p.ptx ? `pneumothorax level ${p.ptx}` : "", p.htxState ? `hemothorax` : "", p.fractures.some((f) => f) ? `fractures: ${BODY_PARTS.filter((_, i) => p.fractures[i]).map((x) => PART_NAMES[x]).join(", ")}` : "",
        p.unconscious ? "unconscious" : "conscious"].filter(Boolean);
    // untreated outcome
    while (sim.p.alive && sim.p.t < s.timeLimit) sim.tick();
    const outcome = sim.p.alive ? `Untreated, the casualty is still alive at ${formatTime(s.timeLimit)} with ${sim.p.bloodVolume.toFixed(2)} L of blood.` : `Untreated, the casualty dies at ${formatTime(sim.p.t)} (${sim.p.causeOfDeath}).`;
    box.append(el("p", { textContent: `Seed ${s.seed}: ${facts.join(", ")}.` }), el("p", { className: sim.p.alive ? "" : "warn-text", textContent: outcome }), list);
    $("preview").hidden = false;
    $("preview").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ------------------------------------------------------------------ actions
function save() {
    const s = check();
    if (!s) return null;
    if (!saveCustom(s)) { status(storageOK ? "Could not save: browser storage is full." : "This browser blocks storage. Export the file instead."); return null; }
    currentId = s.id;
    $("deleteBtn").hidden = false;
    history.replaceState(null, "", `editor.html?id=${encodeURIComponent(s.id)}`);
    fillStartFrom();
    status(`Saved "${s.title}" in this browser.`);
    return s;
}
$("addInjury").addEventListener("click", () => injuryRow());
$("addItem").addEventListener("click", () => itemRow());
$("roleKit").addEventListener("click", () => { $("loadout").tBodies[0].textContent = ""; for (const [c, n] of Object.entries(ROLE_LOADOUT[$("role").value])) itemRow(c, n); });
$("clearKit").addEventListener("click", () => { $("loadout").tBodies[0].textContent = ""; });
$("previewBtn").addEventListener("click", preview);
$("saveBtn").addEventListener("click", save);
$("playBtn").addEventListener("click", () => { const s = save(); if (s) location.href = `play.html?c=${encodeURIComponent(s.id)}`; });
$("exportBtn").addEventListener("click", () => {
    const s = check();
    if (!s) return;
    const { id, custom, ...rest } = s;
    download(`${s.title.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "scenario"}.acm-scenario.json`, JSON.stringify({ format: "acm-trainer-scenario", version: 1, ...rest }, null, 2), "application/json");
});
$("deleteBtn").addEventListener("click", () => {
    if (!currentId || !confirm("Delete this scenario from this browser?")) return;
    deleteCustom(currentId);
    currentId = null;
    history.replaceState(null, "", "editor.html");
    fillStartFrom();
    setForm(blank());
    status("Deleted.");
});
$("startFrom").addEventListener("change", (e) => {
    const v = e.target.value;
    if (!v) { currentId = null; setForm(blank()); return; }
    const [k, id] = [v.slice(0, 1), v.slice(2)];
    if (k === "c") { currentId = id; setForm(getCustom(id)); }
    else { currentId = null; const b = builtIn.find((s) => s.id === id); setForm({ ...b, title: `${b.title} (copy)`, module: "Custom" }); }
    status("");
});
$("importFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    let s;
    try { s = JSON.parse(await f.text()); } catch { status("That file is not valid JSON."); return; }
    delete s.format; delete s.version; delete s.rubric;
    const v = validateScenario(s, data, items);
    if (!v.ok) { status(`Cannot import: ${v.errors.join("; ")}`); return; }
    currentId = null;
    setForm(s);
    status(`Imported "${s.title}". Save it to keep it.`);
});

function blank() {
    return { title: "", role: "medic", track: "combat-medic", timeLimit: 600, seed: 1, patient: { weight: 80, bloodType: "O+", conscious: true },
        injuries: [{ part: "leftleg", mechanism: "bullet", damage: 1 }], loadout: { ...ROLE_LOADOUT.medic }, objectives: [] };
}

fillStartFrom();
const start = params.get("id") && getCustom(params.get("id"));
if (start) { currentId = start.id; setForm(start); } else setForm(blank());
if (params.has("preview")) { if (!$("title").value) $("title").value = "Preview test"; preview(); } // testing aid
if (!storageOK) status("This browser blocks storage: you can build, preview and export scenarios, but not save them here.");
