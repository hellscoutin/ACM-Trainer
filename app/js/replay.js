// Replay viewer: scrub through a finished run second by second. Shows the body diagram with markers, the injury list
// of the selected part, the true vitals and the timeline up to the scrubbed time.
import { createBody } from "./body.js";
import { frameAt } from "../../engine/custom.js";
import { formatTime, PART_NAMES } from "../../engine/injuryList.js";
import { renderProblems } from "./clinical-view.js";

const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };

/** replay: { title, frames, timeline: [{t, text, kind}] }. Returns { destroy }. */
export function mountReplay(host, replay) {
    host.textContent = "";
    const frames = replay.frames || [];
    const end = frames.at(-1)?.t ?? 0;
    let t = 0, part = "body", playing = false, speed = 4, last = 0, raf = 0;

    const slider = el("input", { type: "range", min: 0, max: end, step: 1, value: 0, className: "replay-slider" });
    slider.setAttribute("aria-label", "Replay time");
    const clock = el("span", { className: "replay-clock" });
    const playBtn = el("button", { className: "btn primary", textContent: "Play" });
    const speedSel = el("select", { className: "replay-speed" }, ...[1, 4, 10, 30].map((s) => el("option", { value: s, textContent: `${s}×`, selected: s === speed })));
    speedSel.setAttribute("aria-label", "Replay speed");
    const prevBtn = el("button", { className: "btn", textContent: "◀ Event", title: "Previous treatment or event" });
    const nextBtn = el("button", { className: "btn", textContent: "Event ▶", title: "Next treatment or event" });
    const controls = el("div", { className: "replay-controls" }, playBtn, prevBtn, nextBtn, speedSel, slider, clock);

    const bodyBox = el("div", { className: "body-wrap replay-body" });
    const partTitle = el("h4", {});
    const inj = el("ul", { className: "injuries" });
    const vitals = el("table", { className: "vitals-table" });
    const tl = el("ul", { className: "timeline replay-timeline" });
    const probs = el("div", { className: "replay-problems" });
    const grid = el("div", { className: "replay-grid" },
        el("div", { className: "replay-col" }, bodyBox),
        el("div", { className: "replay-col" }, partTitle, inj),
        el("div", { className: "replay-col" }, el("h4", { textContent: "True vitals" }), vitals, el("h4", { textContent: "Problems at this moment" }), probs, el("h4", { textContent: "Timeline" }), tl));
    host.append(controls, grid);
    const body = createBody(bodyBox, (p) => { part = p; draw(); });

    const marks = [...new Set((replay.timeline || []).map((e) => e.t))].sort((a, b) => a - b);
    const items = (replay.timeline || []).slice().sort((a, b) => a.t - b.t).map((e) => {
        const li = el("li", { className: e.kind === "event" ? "ev" : "" }, el("time", { textContent: formatTime(e.t) }), e.text);
        li.addEventListener("click", () => seek(e.t));
        tl.append(li);
        return { e, li };
    });

    function draw() {
        const f = frameAt(frames, t);
        if (!f) return;
        clock.textContent = `${formatTime(t)} / ${formatTime(end)}`;
        slider.value = String(t);
        body.update(f.colors, part, { tourniquets: [], pulseOx: [], ivAccess: [], ioAccess: [], ...f.o });
        partTitle.textContent = PART_NAMES[part];
        inj.textContent = "";
        for (const [text, color] of f.inj[part] || []) { const li = el("li", { textContent: text || " " }); li.style.color = color; inj.append(li); }
        const v = f.v;
        const state = !v.alive ? "Dead" : v.ca ? "Cardiac arrest" : v.unc ? "Unconscious" : "Conscious";
        vitals.innerHTML = "";
        for (const [a, b, c, d] of [["State", state, "Blood volume", `${v.bv.toFixed(2)} L`], ["Heart rate", v.hr, "Blood pressure", `${v.sys}/${v.dia}`], ["SpO2", `${v.spo2} %`, "Respiration", `${v.rr} /min`]]) {
            vitals.append(el("tr", {}, el("th", { textContent: a }), el("td", { textContent: b }), el("th", { textContent: c }), el("td", { textContent: d })));
        }
        if (replay.problems) renderProblems(probs, replay.problems, { at: t });
        else probs.textContent = "Not recorded for this replay.";
        let lastPast = null;
        for (const it of items) { const past = it.e.t <= t; it.li.classList.toggle("future", !past); if (past) lastPast = it.li; }
        items.forEach((it) => it.li.classList.remove("now"));
        if (lastPast) { lastPast.classList.add("now"); if (playing) lastPast.scrollIntoView({ block: "nearest" }); }
    }
    function seek(nt) { t = Math.max(0, Math.min(end, Math.round(nt))); draw(); }
    function setPlaying(on) {
        playing = on && t < end;
        playBtn.textContent = playing ? "Pause" : "Play";
        if (playing) { last = performance.now(); raf = requestAnimationFrame(loop); }
    }
    let acc = 0;
    function loop(now) {
        if (!playing) return;
        acc += ((now - last) / 1000) * speed;
        last = now;
        if (acc >= 1) { seek(t + Math.floor(acc)); acc -= Math.floor(acc); }
        if (t >= end) { setPlaying(false); return; }
        raf = requestAnimationFrame(loop);
    }
    slider.addEventListener("input", () => seek(Number(slider.value)));
    playBtn.addEventListener("click", () => { if (t >= end) seek(0); setPlaying(!playing); });
    speedSel.addEventListener("change", () => { speed = Number(speedSel.value); });
    prevBtn.addEventListener("click", () => { const m = marks.filter((x) => x < t).at(-1); seek(m ?? 0); });
    nextBtn.addEventListener("click", () => { const m = marks.find((x) => x > t); seek(m ?? end); });
    draw();
    return { destroy() { playing = false; cancelAnimationFrame(raf); host.textContent = ""; } };
}
