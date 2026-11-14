// Procedure windows rebuilt from ACM's dialogs (MeasureBP_Dialog, Stethoscope_Dialog, TransfusionMenu_Dialog) on the
// same GUI grid, with ACM's own artwork and sounds (used with the ACM team's permission).
import { cuffSignal, bagInfo, bagName, addBag, removeBag, DEVICE_NAME } from "../../engine/circulation.js";
import { PART_INDEX } from "../../engine/util.js";

const ASSETS = "assets/acm/";
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };

// ------------------------------------------------------------------ audio
export const audio = {
    ctx: null, buffers: {}, enabled: true,
    async load(name) {
        if (this.buffers[name]) return this.buffers[name];
        this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
        const res = await fetch(`${ASSETS}sound/${name}.mp3`);
        this.buffers[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
        return this.buffers[name];
    },
    /** playSoundUI [name, volume, pitch] */
    async play(name, volume = 1, rate = 1) {
        if (!this.enabled || volume <= 0) return null;
        try {
            const buf = await this.load(name);
            if (this.ctx.state === "suspended") await this.ctx.resume();
            const src = this.ctx.createBufferSource();
            const gain = this.ctx.createGain();
            gain.gain.value = Math.min(1, volume);
            src.buffer = buf;
            src.playbackRate.value = rate;
            src.connect(gain).connect(this.ctx.destination);
            src.start();
            return src;
        } catch { return null; }
    },
    stop(src) { try { src?.stop(); } catch { /* already stopped */ } },
};
const heartSound = (delay) => `heartbeat_${delay < 0.5 ? "fast" : delay > 1.2 ? "slow" : "normal"}_${1 + Math.round(Math.random() * 2)}`;

// ------------------------------------------------------------------ grid stage: ACM GUI grid units -> pixels
function stage(container, x0, y0, wU, hU) {
    const box = el("div", { className: "grid-stage" });
    container.append(box);
    const fit = () => {
        const u = Math.min(container.clientWidth / wU, (window.innerHeight * 0.72) / hU);
        box.style.width = `${wU * u}px`;
        box.style.height = `${hU * u}px`;
        box.style.setProperty("--u", `${u}px`);
        return u;
    };
    let u = fit();
    const place = (node, x, y, w, h) => {
        Object.assign(node.style, { position: "absolute", left: `calc((${x} - ${x0}) * var(--u))`, top: `calc((${y} - ${y0}) * var(--u))`, width: `calc(${w} * var(--u))`, height: `calc(${h} * var(--u))` });
        box.append(node);
        return node;
    };
    const toGrid = (clientX, clientY) => {
        const r = box.getBoundingClientRect();
        u = r.width / wU;
        return [x0 + (clientX - r.left) / u, y0 + (clientY - r.top) / u];
    };
    window.addEventListener("resize", fit);
    return { box, place, toGrid, dispose: () => window.removeEventListener("resize", fit) };
}
const inZone = ([x, y, w, h], [px, py]) => px >= x && px <= x + w && py >= y && py <= y + h;

// ------------------------------------------------------------------ measure blood pressure (MeasureBP_Dialog)
/**
 * Opens the manual blood pressure window. Bulb: +50 (left click) / +30 (right click). Valve: -10 / -2.
 * The needle bounces on each beat between about systolic+20 and diastolic-20 (scaled by strength); with the
 * stethoscope, beats are heard between systolic and diastolic, loudest in the middle (measureBP per-frame).
 */
export function openBP(host, sim, part, stethoscope, getSpeed) {
    host.textContent = "";
    const title = el("div", { className: "win-title", textContent: `Measuring Blood Pressure… Patient (${part === "leftarm" ? "Left Arm" : "Right Arm"})` });
    host.append(title);
    const area = el("div", { className: "win-area" });
    host.append(area);
    const S = stage(area, -13, 4, 48, 28);
    const bg = el("img", { src: `${ASSETS}ui/cuff_background.webp`, alt: "" });
    S.place(bg, 50 - 90, 36 - 67.5, 180, 135);
    S.place(el("img", { src: `${ASSETS}ui/cuff_gauge.webp`, alt: "Pressure gauge and bulb" }), -12, 12, 32, 24);
    const needle = S.place(el("img", { src: `${ASSETS}ui/cuff_needle.png`, alt: "", className: "needle" }), 2.65, 13.12, 16, 12);
    const heart = S.place(el("img", { src: `${ASSETS}ui/heart.png`, alt: "", className: "bp-heart" }), 29.5 - 0.5, 18 - 0.375, 1, 0.75);
    if (stethoscope) S.place(el("img", { src: `${ASSETS}ui/stethoscope_bell.png`, alt: "Stethoscope" }), 29.5 - 2, 18 - 1.5, 4, 3);
    const bulb = S.place(el("button", { className: "hit", title: "Squeeze Bulb\n+50 (LMB) | +30 (RMB)", ariaLabel: "Squeeze bulb (+50, right click +30)" }), -11, 14.8, 9.2, 13);
    const valve = S.place(el("button", { className: "hit", title: "Release Pressure\n-10 (LMB) | -2 (RMB)", ariaLabel: "Release valve (-10, right click -2)" }), -7.5, 28, 2.8, 2.2);
    const readout = el("p", { className: "win-help", textContent: "Bulb: left click +50, right click +30. Valve: left click −10, right click −2. Watch the needle bounce (or listen with the stethoscope) to find systolic and diastolic." });
    host.append(readout);

    const st = { target: 0, gauge: 0, dialTarget: 0, dial: 0, nextStep: 0, nextBeat: 0, src: null };
    const adjust = (v) => { st.target = Math.max(0, Math.min(304, st.target + v)); st.dialTarget = st.target; };
    const bind = (btn, l, r) => {
        btn.addEventListener("click", (e) => { e.preventDefault(); adjust(l); });
        btn.addEventListener("contextmenu", (e) => { e.preventDefault(); adjust(r); });
        btn.addEventListener("keydown", (e) => { if (e.key === "ArrowUp") adjust(Math.abs(r) * Math.sign(l)); });
    };
    bind(bulb, 50, 30);
    bind(valve, -10, -2);

    let raf;
    const loop = (now) => {
        const speed = getSpeed() || 0;
        // gauge and dial step 1 mmHg every 0.03 s of game time
        if (speed > 0 && now >= st.nextStep) {
            if (st.target !== st.gauge) st.gauge += st.target > st.gauge ? 1 : -1;
            if (st.dialTarget !== st.dial) st.dial += st.dialTarget > st.dial ? 1 : -1;
            st.nextStep = now + 30 / speed;
        }
        needle.style.transform = `rotate(${Math.max(0, Math.min(304, st.dial)) * 1.125}deg)`;
        const s = cuffSignal(sim, part);
        if (speed > 0 && s.hr > 0 && now >= st.nextBeat) {
            const delay = 60 / s.hr;
            st.nextBeat = now + (delay * 1000) / speed;
            if (st.dial >= st.dialTarget && st.gauge <= s.systolic + 20 * s.strength && st.gauge >= s.diastolic - 20 * s.strength) st.dial += 2;
            if (stethoscope) {
                if (st.gauge <= s.systolic && st.gauge >= s.diastolic) {
                    const mid = s.systolic - (s.systolic - s.diastolic) / 2;
                    const vol = Math.max(0, Math.min(0.95, 0.95 * (1 - Math.abs(st.gauge - mid) / 40))) * s.strength;
                    audio.play(heartSound(delay), vol, 1 + Math.random() * 0.1);
                }
            } else if (st.gauge <= s.systolic) {
                const effect = Math.max(0.01, Math.min(1, (s.systolic - st.gauge) / 10));
                const full = Math.max(0.8, Math.min(3, 0.8 + ((s.systolic - 80.1) / 59.9) * 2.2)) * effect;
                const rel = Math.max(0.5, Math.min(2, 0.5 + ((s.systolic - 80.1) / 59.9) * 1.5)) * effect;
                const beat = Math.min(0.5, 0.4 * delay), release = Math.min(0.7, 0.6 * delay);
                heart.style.visibility = "visible";
                heart.animate([{ transform: `scale(${rel})` }, { transform: `scale(${full})`, offset: beat / (beat + release) }, { transform: `scale(${rel})` }], { duration: ((beat + release) * 1000) / speed });
            } else heart.style.visibility = "hidden";
        }
        if (stethoscope) heart.style.visibility = "hidden";
        raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    bulb.focus();
    return { close() { cancelAnimationFrame(raf); S.dispose(); host.textContent = ""; } };
}

// ------------------------------------------------------------------ stethoscope (Stethoscope_Dialog)
const Z = {
    rightLung: [[12.5, -1.5, 5.8, 10], [10, 3, 5, 8]], leftLung: [[22, -1.5, 5.8, 10], [25.5, 3, 5, 8]],
    rightSide: [8.5, -5.3, 11.5, 22], leftSide: [20, -5.3, 11.5, 22], sternum: [18, -1.5, 4, 9],
    rightPoints: [[14.3, -5.2, 3, 3], [14, -0.2, 3, 3], [11.5, 4.8, 3, 3], [10.6, 9.8, 3, 3]],
    leftPoints: [[23, -5.2, 3, 3], [23, -0.2, 3, 3], [26.2, 4.8, 3, 3], [27.4, 9.8, 3, 3]],
    heartPoints: [[16.6, 0.3, 2, 2], [21.5, 0.3, 2, 2], [21.7, 2.4, 2, 2], [21.9, 4.6, 2, 2]],
    heartCenter: [20.5, 1.5],
};
/** Opens the stethoscope: click the bell to pick it up, click again to place it. Sounds follow useStethoscope. */
export function openStethoscope(host, sim, getSpeed) {
    host.textContent = "";
    host.append(el("div", { className: "win-title", textContent: "Using Stethoscope… Patient (Torso)" }));
    const area = el("div", { className: "win-area" });
    host.append(area);
    const S = stage(area, 4, -9, 32, 29);
    S.place(el("img", { src: `${ASSETS}ui/body_background.webp`, alt: "" }), 20 - 90, 36 - 67.5, 180, 135);
    const bellSize = 3.5;
    let bellPos = [20, 16];
    const bell = S.place(el("button", { className: "bell", title: "Move stethoscope bell", ariaLabel: "Stethoscope bell: click to pick up, click again to place" }), bellPos[0] - bellSize / 2, bellPos[1] - bellSize / 2, bellSize, bellSize);
    bell.append(el("img", { src: `${ASSETS}ui/stethoscope_bell.png`, alt: "" }));
    host.append(el("p", { className: "win-help", textContent: "Click the bell to pick it up, move it over the chest, click to place it. Listen at the lung points on both sides and over the heart. Arrow keys move the bell." }));
    let moving = false;
    const moveTo = (p) => {
        bellPos = p;
        bell.style.left = `calc((${p[0] - bellSize / 2} - 4) * var(--u))`;
        bell.style.top = `calc((${p[1] - bellSize / 2} + 9) * var(--u))`;
    };
    bell.addEventListener("click", (e) => { e.stopPropagation(); moving = !moving; bell.classList.toggle("moving", moving); });
    S.box.addEventListener("pointermove", (e) => { if (moving) moveTo(S.toGrid(e.clientX, e.clientY)); });
    S.box.addEventListener("click", (e) => { if (moving) { moveTo(S.toGrid(e.clientX, e.clientY)); moving = false; bell.classList.remove("moving"); } });
    bell.addEventListener("keydown", (e) => {
        const d = { ArrowLeft: [-0.5, 0], ArrowRight: [0.5, 0], ArrowUp: [0, -0.5], ArrowDown: [0, 0.5] }[e.key];
        if (d) { e.preventDefault(); moveTo([bellPos[0] + d[0], bellPos[1] + d[1]]); }
    });
    const st = { nextBeat: 0, nextBreath: 0, beat: null, breath: null };
    let raf;
    const loop = (now) => {
        const speed = getSpeed() || 0;
        const p = sim.p;
        if (moving || speed === 0) {
            audio.stop(st.beat); audio.stop(st.breath); st.beat = st.breath = null;
        } else if (p.hr > 0 && p.alive) {
            const c = bellPos;
            const side = inZone(Z.rightSide, c) ? 0 : inZone(Z.leftSide, c) ? 1 : -1;
            let lungLoud = 0, lungPoint = -1;
            if (side > -1) {
                const near = Z.rightLung.some((z) => inZone(z, c)) || Z.leftLung.some((z) => inZone(z, c));
                lungLoud = near ? 0.25 : 0.02;
                lungPoint = (side === 0 ? Z.rightPoints : Z.leftPoints).findIndex((z) => inZone(z, c));
            }
            const heartPoint = Z.heartPoints.findIndex((z) => inZone(z, c));
            const dist = Math.hypot(c[0] - Z.heartCenter[0], c[1] - Z.heartCenter[1]);
            // linearConversion [0.36, 0.1] in screen units ~ [9, 2.5] grid units
            let heartLoud = Math.max(0.03, Math.min(0.5, 0.03 + ((9 - dist) / 6.5) * 0.47));
            const bone = inZone(Z.sternum, c);
            if (now >= st.nextBeat) {
                const delay = 60 / p.hr;
                st.nextBeat = now + (delay * 1000) / speed;
                heartLoud = heartPoint > -1 ? 0.95 : heartLoud;
                if (bone) heartLoud = Math.min(heartLoud, 0.1);
                st.beat = null;
                audio.play(heartSound(delay), heartLoud, 1 + Math.random() * 0.1).then((s) => { st.beat = s; });
            }
            if (p.rr >= 1 && now >= st.nextBreath) {
                const delay = 60 / p.rr;
                st.nextBreath = now + (delay * 1000) / speed;
                if (heartPoint === -1 && side > -1) {
                    const lung = p.lungState[side];
                    const type = lung === 1 ? "shallow" : lung === 2 ? "dull" : "";
                    const mod = lung === 1 ? 0.8 : lung === 2 ? 0.3 : 1;
                    const rate = delay < 2 ? "fast" : delay > 5 ? "slow" : "normal";
                    let loud = lungPoint > -1 ? 0.95 : lungLoud;
                    if (bone) loud = Math.min(loud, 0.1);
                    audio.play(`breath_${rate}${type ? "_" + type : ""}`, loud * mod).then((s) => { st.breath = s; });
                }
            }
        }
        raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    bell.focus();
    return { close() { cancelAnimationFrame(raf); audio.stop(st.beat); audio.stop(st.breath); S.dispose(); host.textContent = ""; } };
}

// ------------------------------------------------------------------ transfusion menu (TransfusionMenu_*)
/**
 * Transfusion menu for one body part: choose an access (IV site or IO), add a bag from the inventory (5 s),
 * remove a bag (2.5 s, returns the bag rounded down to 1000/500/250 ml), toggle flow.
 * `startTimed(label, seconds, fn)` runs a timed step through the main progress bar.
 */
export function openTransfusion(host, sim, part, ctx, { startTimed, onChange }) {
    const i = PART_INDEX[part];
    const accesses = () => [
        ...sim.p.ivAccess[i].map((d, s) => (d ? { iv: true, site: s, label: `${DEVICE_NAME[d]} (${["Upper", "Middle", "Lower"][s]})` } : null)).filter(Boolean),
        ...(sim.p.ioAccess[i] ? [{ iv: false, site: 0, label: DEVICE_NAME[sim.p.ioAccess[i]] }] : []),
    ];
    let sel = 0;
    const render = () => {
        host.textContent = "";
        host.append(el("div", { className: "win-title", textContent: `Transfuse Fluids: ${{ head: "Head", body: "Torso", leftarm: "Left Arm", rightarm: "Right Arm", leftleg: "Left Leg", rightleg: "Right Leg" }[part]}` }));
        const list = accesses();
        if (!list.length) { host.append(el("p", { textContent: "No IV or IO on this body part." })); return; }
        sel = Math.min(sel, list.length - 1);
        const a = list[sel];
        const tabs = el("div", { className: "tf-tabs", role: "tablist" });
        list.forEach((x, k) => {
            const b = el("button", { className: "btn", role: "tab", textContent: x.label });
            b.setAttribute("aria-selected", String(k === sel));
            b.addEventListener("click", () => { sel = k; render(); });
            tabs.append(b);
        });
        host.append(tabs);
        const cols = el("div", { className: "tf-cols" });
        // inventory bags
        const inv = el("div", { className: "tf-col" }, el("h3", { textContent: "Your inventory" }));
        const bagItems = Object.entries(ctx.inventory).filter(([c, n]) => n > 0 && bagInfo(c));
        if (!bagItems.length) inv.append(el("p", { className: "muted", textContent: "No fluid bags" }));
        for (const [cls, n] of bagItems) {
            const b = el("button", { className: "btn tf-item", textContent: `${bagName(cls)} ×${n}` });
            b.addEventListener("click", () => startTimed(`Adding ${bagName(cls)}…`, 5, () => {
                if ((ctx.inventory[cls] || 0) < 1) return;
                const r = addBag(sim, part, a.site, a.iv, cls);
                if (r.ok) { ctx.inventory[cls]--; onChange(`${ctx.name} ${r.log}`); }
                render();
            }));
            inv.append(b);
        }
        // attached bags on this access
        const att = el("div", { className: "tf-col" }, el("h3", { textContent: a.label }));
        const flowOn = a.iv ? sim.p.ivFlow[i][a.site] : sim.p.ioFlow[i];
        const tog = el("button", { className: "btn", textContent: flowOn ? "Flow: ON (stop)" : "Flow: OFF (start)" });
        tog.addEventListener("click", () => { sim.act("setFlow", { part, site: a.site, iv: a.iv, on: !flowOn }); onChange(`${ctx.name} turned flow ${flowOn ? "off" : "on"} (${a.label})`); render(); });
        att.append(tog);
        if (sim.p.tourniquets[i] && !(!a.iv && (i === 2 || i === 3))) att.append(el("p", { className: "warn", textContent: "No flow: tourniquet on this limb" }));
        const bags = sim.p.ivBags.map((b, k) => [b, k]).filter(([b]) => b.part === part && b.iv === a.iv && (!a.iv || b.site === a.site));
        if (!bags.length) att.append(el("p", { className: "muted", textContent: "No bags connected" }));
        for (const [b, k] of bags) {
            const row = el("div", { className: "tf-bag" }, el("span", { textContent: `${b.type}${b.bloodType ? " " + b.bloodType : ""}: ${Math.floor(b.remaining)} / ${b.original} ml` }));
            const rm = el("button", { className: "btn", textContent: "Remove" });
            rm.addEventListener("click", () => startTimed("Removing bag…", 2.5, () => {
                const idx = sim.p.ivBags.indexOf(b);
                if (idx < 0) return;
                const r = removeBag(sim, idx);
                for (const c of r.returned || []) ctx.inventory[c] = (ctx.inventory[c] || 0) + 1;
                onChange(`${ctx.name} removed a ${b.type.toLowerCase()} bag`);
                render();
            }));
            row.append(rm);
            att.append(row);
        }
        cols.append(inv, att);
        host.append(cols);
    };
    render();
    const timer = setInterval(() => { if (!host.querySelector(":focus")) render(); }, 1000);
    return { close() { clearInterval(timer); host.textContent = ""; }, refresh: render };
}
