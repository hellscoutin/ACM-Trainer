// Syringe draw window (SyringeDraw_Dialog) and AED monitor (Lifepak_Monitor_Dialog), with ACM's artwork.
import { VIALS, SYRINGE_DRUGS, vialItem, drugName, doseText } from "../../engine/syringes.js";
import { aedState } from "../../engine/aed.js";
import { audio } from "./windows.js";

const ASSETS = "assets/acm/";
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
const SPAN = { 10: 0.25, 5: 0.245, 3: 0.234, 1: 0.243 }; // plunger travel as a share of the image height (dialog defines)

/**
 * Syringe draw window. Pick a vial, pull the plunger (slider or drag), then Draw (4 s) to keep the filled syringe,
 * or Push IV / Inject IM straight away (2.5 s), as the ACM dialog's buttons do.
 * cb: { draw(drug, ml), inject(drug, ml, iv) } run the timed steps through the main progress bar.
 */
export function openSyringe(host, ctx, part, size, cb) {
    let drug = SYRINGE_DRUGS.find((d) => (ctx.inventory[vialItem(d)] || 0) > 0) || null;
    let ml = 0;
    const render = () => {
        host.textContent = "";
        host.append(el("div", { className: "win-title", textContent: drug ? `Drawing ${drugName(drug)} (${VIALS[drug].label}) into ${size}ml syringe` : "No medication selected" }));
        const wrap = el("div", { className: "syr-wrap" });
        // vial list (Syringe_GetMedicationList: vials in your inventory)
        const list = el("div", { className: "syr-list" }, el("h3", { textContent: "Vials" }));
        const vials = SYRINGE_DRUGS.filter((d) => (ctx.inventory[vialItem(d)] || 0) > 0);
        if (!vials.length) list.append(el("p", { className: "muted", textContent: "No vials in your inventory" }));
        for (const d of vials) {
            const b = el("button", { className: "btn tf-item", textContent: `${drugName(d)} ${VIALS[d].label} ×${ctx.inventory[vialItem(d)]}` });
            b.setAttribute("aria-pressed", String(d === drug));
            b.addEventListener("click", () => { drug = d; ml = 0; render(); });
            list.append(b);
        }
        // syringe picture with the plunger
        const pic = el("div", { className: "syr-pic" });
        const max = drug ? Math.min(size, VIALS[drug].volume) : 0;
        const frac = size ? ml / size : 0;
        const imgs = ["backbit", "plunger", "barrel"].map((k) => el("img", { src: `${ASSETS}ui/syringe/${size}_${k}_ca.png`, alt: "" }));
        imgs[0].style.transform = imgs[1].style.transform = `translateY(${frac * SPAN[size] * 100}%)`;
        pic.append(...imgs);
        // controls
        const ctl = el("div", { className: "syr-ctl" });
        const out = el("div", { className: "syr-amount", textContent: drug ? `${ml.toFixed(2)} / ${size} ml  =  ${doseText(drug, ml)}` : "" });
        const slider = el("input", { type: "range", min: "0", max: String(max), step: "0.01", value: String(ml), disabled: !drug, ariaLabel: "Amount to draw (ml)" });
        slider.addEventListener("input", () => { ml = Number(slider.value); out.textContent = `${ml.toFixed(2)} / ${size} ml  =  ${doseText(drug, ml)}`; imgs[0].style.transform = imgs[1].style.transform = `translateY(${(ml / size) * SPAN[size] * 100}%)`; });
        const note = el("p", { className: "muted", textContent: drug ? `The whole vial is used; the most you can draw is ${max} ml.` : "" });
        const btns = el("div", { className: "syr-btns" });
        const mk = (t, fn) => { const b = el("button", { className: "btn", textContent: t, disabled: !drug }); b.addEventListener("click", () => { if (ml > 0) fn(); }); btns.append(b); };
        mk("Draw (4 s)", () => cb.draw(drug, ml));
        if (part !== "head") { mk("Push IV (2.5 s)", () => cb.inject(drug, ml, true)); mk("Inject IM (2.5 s)", () => cb.inject(drug, ml, false)); }
        ctl.append(out, slider, note, btns);
        wrap.append(list, pic, ctl);
        host.append(wrap);
    };
    render();
    return { close() { host.textContent = ""; }, refresh: render };
}

// ------------------------------------------------------------------ AED monitor
// Image coordinates (2048 px texture, background drawn at 1.05x the button grid): screen and buttons.
const SCREEN = [623, 514, 903, 604];
const B = 1 / 1.05;
const BTN = {
    cpr: [1632, 582, 142, 43], analyze: [1632, 637, 142, 43], nibp: [1635, 819, 142, 43], alarms: [1635, 874, 142, 43],
    charge: [1821, 636, 142, 43], shock: [1855, 697, 80, 80], speeddial: [1772, 1182, 180, 180],
};
const BTN_LABEL = { cpr: "CPR mode (metronome)", analyze: "Analyze", nibp: "Measure NIBP", alarms: "Alarms", charge: "Manual charge", shock: "Shock", speeddial: "Speed dial (cancel charge)" };

/**
 * AED monitor window. cb.press(id) runs the matching menu action ("aed_analyzerhythm", ...). Waveforms are drawn from
 * the simulated rhythm: sinus/VT/PEA complexes at the EKG rate, VF noise, pulseless VT sine waves, flat asystole,
 * CPR artefact; pleth from the pulse oximeter; capnography square waves at the measured rate.
 */
export function openAED(host, sim, cb, getSpeed) {
    host.textContent = "";
    host.append(el("div", { className: "win-title", textContent: "AED Monitor" }));
    const area = el("div", { className: "aed-area" });
    const box = el("div", { className: "aed-box" });
    box.append(el("img", { src: `${ASSETS}ui/lifepak.webp`, alt: "Monitor/defibrillator" }));
    const canvas = el("canvas", { className: "aed-screen" });
    const pct = (v) => `${(v / 2048) * 100}%`;
    Object.assign(canvas.style, { left: pct(SCREEN[0]), top: pct(SCREEN[1]), width: pct(SCREEN[2]), height: pct(SCREEN[3]) });
    box.append(canvas);
    for (const [id, [x, y, w, h]] of Object.entries(BTN)) {
        const b = el("button", { className: "hit aed-btn", title: BTN_LABEL[id], ariaLabel: BTN_LABEL[id] });
        Object.assign(b.style, { left: pct(x * B), top: pct(y * B), width: pct(w * B), height: pct(h * B) });
        b.addEventListener("click", () => cb.press(id));
        box.append(b);
    }
    area.append(box);
    host.append(area, el("p", { className: "win-help", textContent: "Buttons on the monitor: ANALYZE, CHARGE, the red SHOCK button, NIBP, ALARMS, CPR (metronome on/off) and the speed dial (cancels a charge). Connect pads, pulse oximeter, cuff and capnograph from the medical menu." }));

    const ctx2 = canvas.getContext("2d");
    const W = 900, H = 600;
    canvas.width = W; canvas.height = H;
    const traces = { ekg: new Float32Array(W), po: new Float32Array(W), co: new Float32Array(W) };
    let x = 0, phase = { ekg: 0, po: 0, co: 0 }, last = performance.now(), raf;
    const LEFT = 180;
    const sample = (kind, dt) => {
        const p = sim.p, a = aedState(p);
        if (kind === "ekg") {
            if (!a.pads) return NaN;
            const rate = a.liveEKG ?? 0;
            if (p.cpr) { phase.ekg += dt * (p.hr / 60); return Math.sin(phase.ekg * 2 * Math.PI) * 0.6; }
            if (p.lastShock + 60 > p.t || rate <= 0) return (Math.random() - 0.5) * 0.03;
            if (p.rhythm === "VF") { phase.ekg += dt; const t = phase.ekg; return 0.35 * Math.sin(t * 31) + 0.25 * Math.sin(t * 47 + 1) + 0.15 * Math.sin(t * 13 + 2); }
            if (p.rhythm === "PVT" || p.rhythm === "VT") { phase.ekg += dt * (rate / 60); return 0.8 * Math.sin(phase.ekg * 2 * Math.PI); }
            phase.ekg = (phase.ekg + dt * (rate / 60)) % 1;
            const f = phase.ekg; // P, QRS, T
            return 0.12 * Math.exp(-(((f - 0.15) / 0.04) ** 2)) - 0.15 * Math.exp(-(((f - 0.30) / 0.012) ** 2)) + 1.0 * Math.exp(-(((f - 0.33) / 0.012) ** 2)) - 0.25 * Math.exp(-(((f - 0.36) / 0.012) ** 2)) + 0.25 * Math.exp(-(((f - 0.58) / 0.06) ** 2));
        }
        if (kind === "po") {
            if (a.po === -1 || a.display.spo2 <= 0) return NaN;
            phase.po = (phase.po + dt * (p.hr / 60)) % 1;
            const f = phase.po;
            return Math.exp(-(((f - 0.25) / 0.1) ** 2)) + 0.35 * Math.exp(-(((f - 0.55) / 0.08) ** 2));
        }
        if (!a.capno || a.display.co2 <= 0 || a.display.rr <= 0) return NaN;
        phase.co = (phase.co + dt * (a.display.rr / 60)) % 1;
        const f = phase.co;
        return f < 0.1 ? f / 0.1 : f < 0.5 ? 1 - (f - 0.1) * 0.15 : f < 0.55 ? (1 - 0.06) * (1 - (f - 0.5) / 0.05) : 0;
    };
    const draw = (now) => {
        const speed = getSpeed() || 0;
        const dt = Math.min(0.1, (now - last) / 1000) * speed;
        last = now;
        const steps = Math.max(0, Math.round((dt * 150)));
        for (let k = 0; k < steps; k++) {
            const sdt = dt / Math.max(1, steps);
            traces.ekg[x] = sample("ekg", sdt); traces.po[x] = sample("po", sdt); traces.co[x] = sample("co", sdt);
            x = (x + 1) % W;
        }
        const p = sim.p, a = aedState(p);
        ctx2.fillStyle = "#000"; ctx2.fillRect(0, 0, W, H);
        // top bar message
        ctx2.fillStyle = "#222"; ctx2.fillRect(0, 0, W, 34);
        ctx2.font = "bold 28px Segoe UI, Arial"; ctx2.fillStyle = a.charged ? "#ff4b4b" : "#ffd75e"; ctx2.textAlign = "center";
        ctx2.fillText(a.message || (a.charged ? "CHARGED" : ""), W / 2, 25);
        ctx2.textAlign = "left";
        // vitals column (HR green, SpO2 blue, CO2 orange, NIBP white)
        const rows = [
            ["HR", a.display.hr || "--", "#00ff00"], ["SpO2", a.display.spo2 || "--", "#0099ff"],
            ["CO2", a.display.co2 || "--", "#ff8033"], ["NIBP", a.display.bp[0] ? `${a.display.bp[0]}/${a.display.bp[1]}` : "--/--", "#ffffff"],
        ];
        rows.forEach(([lab, val, col], k) => {
            const y0 = 40 + k * 140;
            ctx2.fillStyle = col; ctx2.font = "bold 24px Segoe UI, Arial"; ctx2.fillText(lab, 10, y0 + 22);
            ctx2.font = `bold ${lab === "NIBP" ? 44 : 72}px Segoe UI, Arial`; ctx2.fillText(String(val), 20, y0 + 90);
            if (lab === "CO2") { ctx2.font = "bold 22px Segoe UI, Arial"; ctx2.fillText(`RR ${a.display.rr || "--"}`, 10, y0 + 120); }
        });
        ctx2.fillStyle = "#333"; ctx2.fillRect(LEFT - 4, 34, 2, H - 34);
        // traces
        const lanes = [["ekg", "#00ff00", 120, 90], ["po", "#0099ff", 300, 70], ["co", "#ff8033", 470, 60]];
        for (const [k, col, base, amp] of lanes) {
            ctx2.strokeStyle = col; ctx2.lineWidth = 2; ctx2.beginPath();
            let pen = false;
            const start = (x - (W - LEFT) + W) % W; // newest W-LEFT samples, oldest on the left
            for (let i = 0; i < W - LEFT; i++) {
                const v = traces[k][(start + i) % W];
                if (Number.isNaN(v)) { pen = false; continue; }
                const px = LEFT + i, py = base - v * amp;
                if (!pen) { ctx2.moveTo(px, py); pen = true; } else ctx2.lineTo(px, py);
            }
            ctx2.stroke();
        }
        raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return { close() { cancelAnimationFrame(raf); host.textContent = ""; } };
}

/** Device sounds that run continuously while connected: CPR metronome, charged alarm, heartbeat beep. */
export function aedAmbient(sim, getSpeed) {
    let nextTick = 0, nextAlarm = 0, nextBeep = 0;
    return (now) => {
        const speed = getSpeed() || 0;
        const p = sim.p, a = sim.p.aed;
        if (!a || speed === 0) return;
        if (a.tracking && !a.mutedCPR && now >= nextTick) { audio.play("aed_cprtick", 0.5); nextTick = now + 600 / speed; }
        if (a.charged && now >= nextAlarm) { audio.play("aed_alarm", 0.5); nextAlarm = now + 528 / speed; }
        const silent = p.lastShock + 65 > p.t || a.busy || a.tracking || a.mutedAlarm;
        if (a.pads && !a.inUse && !silent && !p.cpr && (a.liveEKG || 0) > 0 && !["VF", "PVT"].includes(p.rhythm) && now >= nextBeep) {
            audio.play("aed_hr_beep", 0.35);
            nextBeep = now + (60000 / a.liveEKG) / speed;
        }
    };
}
