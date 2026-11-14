// Surgical airway window (SurgicalAirway_Dialog) on ACM's grid and artwork.
// Mouse as in game: hold right button to palpate (marker colour shows the landmarks); select the scalpel and drag
// with the left button to cut (vertical first; right-click toggles to horizontal once the vertical cut is right);
// select a tool and click where it is used. Touch: "Palpate" mode button and "Rotate scalpel" button.
import { ZONES, inZone, palpate, beginIncision, finishIncision, action } from "../../engine/surgicalAirway.js";

const A = "assets/acm/ui/cric/";
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
const X0 = 2, Y0 = 0, W = 30, H = 21;
const TOOLS = [
    { id: 0, key: "scalpel", label: "Scalpel" }, { id: 1, key: "hook", label: "Tracheal Hook" }, { id: 2, key: "tube", label: "Cric-Key" },
    { id: 3, key: "syringe", label: "Syringe" }, { id: 4, key: "strap", label: "Neck Strap" },
];

/** cb: { hint(lines), close(reason) } */
export function openCric(host, sim, cb) {
    const sa = sim.p.sa;
    let tool = -1, vertical = true, palpating = false, cutting = null, palpMode = false;
    host.textContent = "";
    host.append(el("div", { className: "win-title", textContent: "Establishing Surgical Airway..." }));
    const row = el("div", { className: "cric-row" });
    const tray = el("div", { className: "cric-tray", role: "toolbar", ariaLabel: "Instruments" });
    const area = el("div", { className: "cric-area" });
    row.append(tray, area);
    host.append(row);
    const stage = el("div", { className: "grid-stage cric-stage" });
    area.append(stage);
    const fit = () => {
        const u = Math.min(area.clientWidth / W, (window.innerHeight * 0.62) / H);
        stage.style.width = `${W * u}px`; stage.style.height = `${H * u}px`; stage.style.setProperty("--u", `${u}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    const place = (node, x, y, w, h) => {
        Object.assign(node.style, { position: "absolute", left: `calc(${x - X0} * var(--u))`, top: `calc(${y - Y0} * var(--u))`, width: `calc(${w} * var(--u))`, height: `calc(${h} * var(--u))` });
        stage.append(node);
        return node;
    };
    const toGrid = (e) => { const r = stage.getBoundingClientRect(); const u = r.width / W; return [X0 + (e.clientX - r.left) / u, Y0 + (e.clientY - r.top) / u]; };
    place(el("img", { src: `${A}body_background.webp`, alt: "" }), -30, -27.5, 100, 75);
    const cuts = el("div"); stage.append(cuts);
    const big = place(el("img", { src: `${A}incision_0_0.png`, alt: "", className: "hide" }), 0, 7.65, 6.3, 4.725);
    const hookImg = place(el("img", { src: `${A}placed_hook.png`, alt: "", className: "hide" }), 0, 0.6, 25.2, 18.9);
    const tubeImg = place(el("img", { src: `${A}placed_tube_0.png`, alt: "", className: "hide" }), -5.55, -9.25, 51.2, 38.4);
    const liveCut = el("div", { className: "cric-cut hide" }); stage.append(liveCut);
    const marker = place(el("div", { className: "cric-marker hide" }), 0, 0, 0.6, 0.6);
    const active = place(el("img", { alt: "", className: "cric-active hide" }), 0, 0, 25, 25);
    // action zones (invisible buttons, as in the dialog; tooltips name the step)
    const ACTIONS = [
        ["liftIncision", 1, "Lift Incision"], ["insertTube", 2, "Insert Cric-Key"], ["removeHook", 3, "Remove Tracheal Hook"],
        ["inflateCuff", 4, "Inflate Tube Cuff"], ["removeStylet", 5, "Remove Stylet"], ["connectStrap", 6, "Connect Strap"], ["secureStrap", 7, "Secure Strap"],
    ];
    const zoneBtns = {};
    for (const [k, type, label] of ACTIONS) {
        const z = ZONES[k];
        const b = place(el("button", { className: "hit cric-zone hide", title: label, ariaLabel: label }), z[0], z[1], z[2], z[3]);
        b.addEventListener("click", (e) => { e.stopPropagation(); doAction(type); });
        zoneBtns[type] = b;
    }
    const help = el("p", { className: "win-help" });
    const ctl = el("div", { className: "cric-ctl" });
    const palpBtn = el("button", { className: "btn", textContent: "Palpate mode: off" });
    palpBtn.addEventListener("click", () => { palpMode = !palpMode; palpBtn.textContent = `Palpate mode: ${palpMode ? "on" : "off"}`; });
    const rotBtn = el("button", { className: "btn", textContent: "Rotate scalpel" });
    rotBtn.addEventListener("click", () => toggleDir());
    ctl.append(palpBtn, rotBtn);
    host.append(ctl, help);

    const toolBtns = TOOLS.map((t) => {
        const b = el("button", { className: "cric-tool", title: t.label, ariaLabel: t.label }, el("img", { src: `${A}inv_${t.key}.png`, alt: "" }));
        b.addEventListener("click", () => select(t.id));
        tray.append(b);
        return b;
    });

    // SurgicalAirway_select
    function select(id) {
        if (tool === -1) tool = id;
        else if (id === tool && !(id === 2 && sa.tube) && !(id === 4 && sa.strapSecure)) tool = -1;
        render();
    }
    function toggleDir() {
        if (tool !== 0 || cutting || !sa.verticalSuccess) return;
        vertical = !vertical;
        render();
    }
    function doAction(type) {
        const before = { hook: sa.hook, tube: sa.tube, strap: sa.strapSecure };
        const msg = action(sim, type);
        if (msg) cb.hint([msg]);
        // the dialog puts tools back after these steps
        if ((!before.hook && sa.hook) || (!before.tube && sa.tube) || (!before.strap && sa.strapSecure)) tool = -1;
        if (before.hook && !sa.hook) tool = 1; // removing the hook puts it in your hand
        if (sa.hook) { hookImg.style.left = `calc(${sa.incisionX + 3.15 - 12.6 - X0} * var(--u))`; }
        render();
    }
    function render() {
        const p = sa.progress;
        toolBtns.forEach((b, i) => {
            let disabled = false, selected = tool === i;
            if (i === 0 && tool !== 0 && p > 0) disabled = true;
            if (i === 1 && (sa.hook || (p > 3 && tool !== 1))) disabled = true;
            if (i === 2 && sa.tube) disabled = true;
            if (i === 3 && sa.cuff && tool !== 3) disabled = true;
            if (i === 4 && sa.strapSecure) disabled = true;
            b.disabled = disabled;
            b.classList.toggle("selected", selected);
            b.title = selected ? "Put Back" : TOOLS[i].label;
        });
        const img = { 0: vertical ? "active_scalpel_v" : "active_scalpel_h", 1: "active_hook", 2: "active_tube", 3: "active_syringe", 4: "active_strap" }[tool];
        if (img) { active.src = `${A}${img}.png`; active.classList.remove("hide"); } else active.classList.add("hide");
        const sz = tool === 2 ? 50 : 25;
        active.style.width = `calc(${sz} * var(--u))`; active.style.height = `calc(${sz} * var(--u))`;
        // SurgicalAirway_updateActions
        const show = {
            1: p === 1 && tool === 1, 2: p === 2 && tool === 2, 3: p === 3 && tool === -1,
            5: p > 3 && tool === -1 && sa.stylet, 4: p > 3 && tool === 3 && !sa.cuff,
            6: p > 3 && tool === 4 && !sa.stylet && !sa.strapSecure && !sa.strapConnected, 7: p > 3 && tool === 4 && !sa.stylet && !sa.strapSecure && sa.strapConnected,
        };
        for (const [type, b] of Object.entries(zoneBtns)) b.classList.toggle("hide", !show[type]);
        big.classList.toggle("hide", !sa.spread && sa.progress === 0);
        big.src = `${A}incision_${sa.progress >= 2 ? 2 : sa.progress >= 1 ? 1 : 0}_0.png`;
        if (sa.incisionX >= 0) big.style.left = `calc(${sa.incisionX - X0} * var(--u))`;
        hookImg.classList.toggle("hide", !sa.hook);
        tubeImg.classList.toggle("hide", !sa.tube);
        tubeImg.src = `${A}placed_tube_${sa.strapSecure ? 2 : sa.stylet ? 0 : 1}.png`;
        rotBtn.disabled = !(tool === 0 && sa.verticalSuccess);
        const step = sim.p.surgicalAirway
            ? (sa.strapSecure ? "Airway established and strapped. Close the window." : "Airway established. Connect and secure the neck strap, or close and strap it later.")
            : !sa.verticalSuccess ? "Palpate (hold right mouse button) to find the landmarks, then cut vertically across the cricothyroid membrane with the scalpel."
            : sa.progress === 0 ? "Palpate the opening to spread it with a finger, then rotate the scalpel (right-click) and cut horizontally through the membrane."
            : sa.progress === 1 ? "Lift the incision with the tracheal hook." : sa.progress === 2 ? "Insert the Cric-Key." : sa.progress === 3 ? "Remove the tracheal hook (empty hand)."
            : "Inflate the cuff with the syringe and remove the stylet.";
        help.textContent = `${step} Incisions: ${sa.incisionCount}.`;
    }

    const inArea = (pt) => inZone(ZONES.actionArea, pt);
    stage.addEventListener("contextmenu", (e) => e.preventDefault());
    stage.addEventListener("pointerdown", (e) => {
        const pt = toGrid(e);
        if (e.button === 2 && tool === 0) return;
        if (e.button === 2 || (palpMode && tool === -1)) {
            if (!inArea(pt) || tool !== -1) return;
            palpating = true; stage.setPointerCapture(e.pointerId); movePalp(pt); return;
        }
        if (e.button === 0 && tool === 0 && inArea(pt)) {
            cutting = { start: pt, end: vertical ? pt[1] : pt[0] };
            beginIncision(sim);
            stage.setPointerCapture(e.pointerId);
            drawCut();
        }
    });
    stage.addEventListener("pointermove", (e) => {
        const pt = toGrid(e);
        if (tool >= 0) {
            const sz = tool === 2 ? 50 : 25;
            active.style.left = `calc(${pt[0] - sz / 2 - X0} * var(--u))`; active.style.top = `calc(${pt[1] - sz / 2 - Y0} * var(--u))`;
            active.style.opacity = inArea(pt) || (tool === 3 && inZone(ZONES.inflateCuff, pt)) ? "1" : "0.5";
        }
        if (palpating) { if (!inArea(pt)) { palpating = false; marker.classList.add("hide"); } else movePalp(pt); }
        if (cutting) {
            if (!inArea(pt)) { endCut(); return; }
            cutting.end = vertical ? Math.max(cutting.end, pt[1]) : Math.max(cutting.end, pt[0]);
            drawCut();
        }
    });
    stage.addEventListener("pointerup", (e) => {
        if (e.button === 2 && tool === 0) { toggleDir(); return; }
        if (palpating) { palpating = false; marker.classList.add("hide"); }
        if (cutting) endCut();
    });
    function movePalp(pt) {
        marker.classList.remove("hide");
        marker.style.left = `calc(${pt[0] - 0.3 - X0} * var(--u))`; marker.style.top = `calc(${pt[1] - 0.3 - Y0} * var(--u))`;
        marker.style.background = palpate(sa, pt);
        if (sa.verticalSuccess && !sa.spread && inZone(ZONES.entry, pt)) { sa.spread = true; cb.hint(["Expanded incision with finger"]); render(); }
    }
    function cutRect() {
        const [sx, sy] = cutting.start;
        return vertical ? [sx - 0.05, sy, 0.1, Math.max(0, cutting.end - sy)] : [sx, sy - 0.05, Math.max(0, cutting.end - sx), 0.1];
    }
    function drawCut() {
        const [x, y, w, h] = cutRect();
        liveCut.classList.remove("hide");
        Object.assign(liveCut.style, { left: `calc(${x - X0} * var(--u))`, top: `calc(${y - Y0} * var(--u))`, width: `calc(${Math.max(w, 0.12)} * var(--u))`, height: `calc(${Math.max(h, 0.12)} * var(--u))` });
    }
    function endCut() {
        const rect = cutRect();
        const len = vertical ? rect[3] : 0;
        const wasVertical = vertical;
        cutting = null;
        liveCut.classList.add("hide");
        if (wasVertical && rect[3] > 0) {
            const mark = el("img", { src: `${A}incision_vertical.png`, alt: "" });
            const add = Math.min(1, len * 0.4); // ACM: linearConversion [0, 0.1, size, 0, 0.04] screen units = up to 1 grid unit
            Object.assign(mark.style, { position: "absolute", left: `calc(${rect[0] + 0.05 - 3.15 - X0} * var(--u))`, top: `calc(${rect[1] - Y0} * var(--u))`, width: `calc(6.3 * var(--u))`, height: `calc(${rect[3] + add} * var(--u))` });
            cuts.append(mark);
        }
        const r = finishIncision(sim, rect, wasVertical, len);
        if (r.failed) { cb.close("failed"); return; }
        render();
    }
    render();
    return { close() { window.removeEventListener("resize", fit); host.textContent = ""; } };
}
