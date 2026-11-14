// Renders the problems list (debrief, replay, instructor) and the full clinical state (instructor "full patient state").
import { formatTime, PART_NAMES } from "../../engine/injuryList.js";

const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
const STATUS = {
    resolved: ["Resolved", "ok"], "resolved on its own": ["Resolved on its own", "info"], treated: ["Treated, still present", "warn"],
    "not treated": ["Not treated", "bad"], info: ["", "info"],
};

/** Adds readable treatment labels to problems (labelFn: action id -> menu label). */
export function labelProblems(problems, labelFn) {
    return problems.map((p) => ({ ...p, treatments: p.treatments.map((t) => ({ ...t, label: t.id.startsWith("bag:") ? `Transfusion: ${t.id.slice(4)}` : labelFn(t.id) })) }));
}

/**
 * Problems table. opts.at: show the state at that time (replay): only problems that had started, with treatments
 * done so far, and "active" / "over" instead of the final status.
 */
export function renderProblems(container, problems, opts = {}) {
    container.textContent = "";
    const at = opts.at;
    const list = at === undefined ? problems : problems.filter((p) => p.start <= at);
    if (!list.length) { container.append(el("p", { className: "muted", textContent: at === undefined ? "No problems detected." : "No problems yet." })); return; }
    const ul = el("ul", { className: "problems" });
    for (const p of list) {
        const over = at !== undefined && p.end !== null && p.end <= at;
        const done = p.treatments.filter((t) => at === undefined || t.t <= at);
        let [text, cls] = STATUS[p.status] || ["", "info"];
        if (at !== undefined) [text, cls] = over ? ["Over", "ok"] : p.status === "info" ? ["", "info"] : done.length ? ["Active, treated", "warn"] : ["Active, not treated yet", "bad"];
        const when = `${formatTime(p.start)}${p.end !== null && (at === undefined || p.end <= at) ? `–${formatTime(p.end)}` : " → " + (at === undefined ? "end" : "now")}`;
        const li = el("li", { className: `prob ${cls}` },
            el("div", { className: "prob-head" }, el("strong", { textContent: p.label }), text ? el("span", { className: `badge ${cls}`, textContent: text }) : ""),
            el("div", { className: "prob-meta", textContent: `${when}${p.worst ? ` · worst ${p.worst}` : ""}` }));
        if (done.length) li.append(el("div", { className: "prob-done", textContent: "Done: " + done.map((t) => `${t.label || t.id}${t.part && !p.part ? ` (${PART_NAMES[t.part] || t.part})` : ""} at ${formatTime(t.t)}`).join("; ") }));
        ul.append(li);
    }
    container.append(ul);
}

const row = (...cells) => el("tr", {}, ...cells.map((c, i) => el(i % 2 ? "td" : "th", { textContent: c ?? "" })));
const yes = (b) => (b ? "yes" : "no");

/** Full clinical state (engine/clinical.js clinicalState). */
export function renderClinical(container, c) {
    container.textContent = "";
    if (!c) { container.append(el("p", { className: "muted", textContent: "No data yet." })); return; }
    const sec = (title, ...rows) => container.append(el("h4", { textContent: title }), el("table", { className: "vitals-table clinical" }, ...rows));
    sec("Status", row("Consciousness", c.consciousness, "Rhythm", `${c.rhythm}${c.reversibleArrest ? " (reversible)" : ""}`));
    const a = c.airway;
    sec("Airway", row("Airway state", `${a.state} %`, "Reflex", yes(a.reflex)), row("Collapse", a.collapse ? `level ${a.collapse}` : "none", "Obstruction", a.vomit || a.blood ? `vomit ${a.vomit}, blood ${a.blood}` : "none"),
        row("Adjuncts", a.adjuncts || "none", "Positioning", a.positioning || "none"));
    const b = c.breathing;
    sec("Breathing", row("Respiration", `${b.rr} /min`, "SpO2", `${b.spo2} %`), row("Pneumothorax", b.ptx ? `level ${b.ptx}${b.tension ? " (TENSION)" : ""}` : b.tension ? "TENSION" : "none", "Hemothorax", b.htxLevel || b.htxFluid ? `level ${b.htxLevel}, ${b.htxFluid} L in chest` : "none"),
        row("Chest injury", yes(b.chestInjury), "Chest seal", yes(b.chestSeal)), row("Breathing state", `${b.state} %`, "Thoracostomy", b.thoracostomy || "none"));
    const ci = c.circulation;
    sec("Circulation", row("Heart rate", ci.hr, "Blood pressure", `${ci.sys}/${ci.dia}`), row("Blood volume", `${ci.bloodVolume} L`, "Blood / plasma / saline", `${ci.blood} / ${ci.plasma} / ${ci.saline} L`),
        row("External bleeding", `${ci.externalBleeding} ml/min`, "Internal bleeding", `${ci.internalBleeding} ml/min`),
        row("Bleeding from", ci.bleedingParts.map((x) => `${PART_NAMES[x.part]} ${x.ml}`).join(", ") || "none", "Tourniquets", ci.tourniquets.map((x) => `${PART_NAMES[x.part]}${x.minutes !== null ? ` ${x.minutes} min` : ""}`).join(", ") || "none"),
        row("Platelets", ci.platelets, "Fluid overload", `${ci.overload} L`), row("Transfused (uncleared)", `${ci.transfused} L`, "Calcium", ci.calcium),
        row("Hemolytic reaction", ci.hemolytic ? `severity ${ci.hemolytic}` : "none", "Running bags", ci.bags.map((x) => `${x.type}${x.bloodType ? " " + x.bloodType : ""} ${x.remaining} ml`).join(", ") || "none"));
    const d = c.disability;
    sec("Disability", row("Pain felt", `${d.pain} %`, "Pain / suppressed", `${d.painRaw} % / ${d.painSuppressed} %`),
        row("Fractures", d.fractures.map((x) => `${PART_NAMES[x.part]} ${x.state}${x.severity ? ` (${x.severity})` : ""}`).join(", ") || "none", "", ""));
    if (c.cbrn) {
        const x = c.cbrn;
        sec("CBRN", row("Agent", x.agent, "In the cloud", yes(x.inCloud)), row("Buildup", `sarin ${x.sarin}, lewisite ${x.lewisite}, chlorine ${x.chlorine}, CS ${x.cs}`, "Airway spasm", yes(x.spasm)),
            row("Inflammation", x.inflammation, "Lung damage", x.lungDamage), row("Capillary damage", x.capillary, "Mask / filter", x.mask ? `on, ${x.filter} s` : "none"));
    }
    container.append(el("h4", { textContent: "Drugs in the system" }));
    if (!c.meds.length) container.append(el("p", { className: "muted", textContent: "None." }));
    else {
        const t = el("table", { className: "records meds" }, el("thead", {}, el("tr", {}, ...["Drug", "Route", "Given", "Leaves in", "Effect now", "Phase", "Acting on"].map((h) => el("th", { textContent: h })))));
        const tb = el("tbody");
        for (const m of c.meds) {
            tb.append(el("tr", {}, ...[m.name.replace(/_/g, " "), `${m.route}${m.part ? ` (${PART_NAMES[m.part]})` : ""}`, `${formatTime(m.since)} ago`, formatTime(m.remaining), `${m.effect} %`, m.phase,
                Object.entries(m.effects).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(", ") || "–"].map((x) => el("td", { textContent: x }))));
        }
        t.append(tb);
        container.append(t);
    }
}
