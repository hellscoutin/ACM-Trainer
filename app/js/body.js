// Body diagram (drawn here, not copied from ACE). Viewed from the front: the patient's left side is on the right.
const NS = "http://www.w3.org/2000/svg";
const SHAPES = {
    head: { tag: "ellipse", a: { cx: 100, cy: 40, rx: 26, ry: 30 } },
    body: { tag: "path", a: { d: "M70 78 Q100 70 130 78 L138 92 L134 210 Q100 222 66 210 L62 92 Z" } },
    rightarm: { tag: "path", a: { d: "M60 84 L44 92 L26 196 L30 236 L46 238 L50 200 L64 112 Z" } },
    leftarm: { tag: "path", a: { d: "M140 84 L156 92 L174 196 L170 236 L154 238 L150 200 L136 112 Z" } },
    rightleg: { tag: "path", a: { d: "M68 214 Q84 222 98 220 L96 330 L92 404 L70 406 L66 330 Z" } },
    leftleg: { tag: "path", a: { d: "M132 214 Q116 222 102 220 L104 330 L108 404 L130 406 L134 330 Z" } },
};
// Where tourniquets, pulse oximeters and labels are drawn
const TQ = { leftarm: [140, 104, 22, 9, 12], rightarm: [38, 104, 22, 9, -12], leftleg: [104, 236, 30, 9, 0], rightleg: [66, 236, 30, 9, 0] };
const OX = { leftarm: [154, 232], rightarm: [30, 232] };
const COLOR = { airway: "#30e8ed", circulation: "#33a633", aed: "#2e99f5", seal: "#fff200", pulseOx: "#4dcccc" }; // ACM_gui gui.hpp colorText
const NAMES = { head: "Head", body: "Torso", leftarm: "Left Arm", rightarm: "Right Arm", leftleg: "Left Leg", rightleg: "Right Leg" };

export function createBody(container, onSelect) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 200 420");
    svg.setAttribute("class", "body-svg");
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", "Body parts");
    const parts = {};
    for (const [id, s] of Object.entries(SHAPES)) {
        const el = document.createElementNS(NS, s.tag);
        for (const [k, v] of Object.entries(s.a)) el.setAttribute(k, v);
        el.setAttribute("class", "part");
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", NAMES[id]);
        el.addEventListener("click", () => onSelect(id));
        el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(id); } });
        svg.append(el);
        parts[id] = el;
    }
    const overlay = document.createElementNS(NS, "g");
    svg.append(overlay);
    const side = (x, t) => { const el = document.createElementNS(NS, "text"); el.setAttribute("x", x); el.setAttribute("y", 416); el.setAttribute("fill", "#a9adb1"); el.setAttribute("font-size", "12"); el.setAttribute("text-anchor", "middle"); el.textContent = t; svg.append(el); };
    side(30, "R"); side(170, "L");
    container.append(svg);

    return {
        update(colors, selected, p) {
            const order = ["head", "body", "leftarm", "rightarm", "leftleg", "rightleg"];
            order.forEach((id, i) => {
                parts[id].style.fill = colors[i];
                parts[id].classList.toggle("selected", id === selected);
                parts[id].setAttribute("aria-pressed", String(id === selected));
            });
            overlay.textContent = "";
            order.forEach((id, i) => {
                if (p.tourniquets[i] && TQ[id]) {
                    const [x, y, w, h, rot] = TQ[id];
                    const r = document.createElementNS(NS, "rect");
                    Object.entries({ x, y, width: w, height: h, rx: 2, class: "tq", transform: `rotate(${rot} ${x + w / 2} ${y + h / 2})` }).forEach(([k, v]) => r.setAttribute(k, v));
                    overlay.append(r);
                }
            });
            ["leftarm", "rightarm"].forEach((id, k) => {
                if (p.pulseOx[k]) {
                    const [x, y] = OX[id];
                    const r = document.createElementNS(NS, "rect");
                    Object.entries({ x: x - 7, y: y - 4, width: 14, height: 10, rx: 2, fill: "#4dcccc", stroke: "#000" }).forEach(([a, v]) => r.setAttribute(a, v));
                    overlay.append(r);
                }
            });
            // IV sites (upper/middle/lower), IO and pressure cuff markers
            const SITE_POS = {
                leftarm: [[150, 120], [158, 160], [163, 200]], rightarm: [[50, 120], [42, 160], [37, 200]],
                leftleg: [[116, 260], [118, 310], [119, 370]], rightleg: [[84, 260], [82, 310], [81, 370]],
            };
            const box = (cx, cy, w, h, fill, rot = 0, rx = 2) => {
                const r = document.createElementNS(NS, "rect");
                Object.entries({ x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx, fill, stroke: "#000", "stroke-width": 1, transform: `rotate(${rot} ${cx} ${cy})` }).forEach(([a, v]) => r.setAttribute(a, v));
                overlay.append(r);
                return r;
            };
            const dot = (x, y, fill, r = 4.5) => {
                const c = document.createElementNS(NS, "circle");
                Object.entries({ cx: x, cy: y, r, fill, stroke: "#000", "stroke-width": 1.2 }).forEach(([a, v]) => c.setAttribute(a, v));
                overlay.append(c);
            };
            order.forEach((id, i) => {
                (p.ivAccess[i] || []).forEach((dev, s) => { if (dev && SITE_POS[id]) dot(...SITE_POS[id][s], dev === "IV_14g" ? "#9be36b" : "#5fb35f"); });
                if (p.ioAccess[i]) id === "body" ? box(100, 92, 9, 9, COLOR.circulation) : SITE_POS[id] && box(...SITE_POS[id][1], 9, 9, COLOR.circulation);
            });
            ["leftarm", "rightarm"].forEach((id, k) => {
                if (p.pressureCuff?.[k]) {
                    const [x, y] = SITE_POS[id][0];
                    const r = document.createElementNS(NS, "rect");
                    Object.entries({ x: x - 12, y: y - 8, width: 24, height: 12, rx: 3, fill: COLOR.circulation, stroke: "#000", "stroke-width": 1, transform: `rotate(${k ? -12 : 12} ${x} ${y})` }).forEach(([a, v]) => r.setAttribute(a, v));
                    overlay.append(r);
                }
            });
            // ACE updateBodyImage: bone icon red when fractured; blue when splinted, only with ACE fractures setting 2 or 3
            const MID = { leftarm: [161, 172, -8], rightarm: [39, 172, 8], leftleg: [118, 300, 0], rightleg: [82, 300, 0] };
            order.forEach((id, i) => {
                if (!MID[id] || !p.fractures) return;
                const f = p.fractures[i];
                if (!(f === 1 || (f === -1 && p.splintBone))) return;
                const [x, y, rot] = MID[id];
                const color = f === 1 ? "#ff0000" : "#0000ff";
                const g = document.createElementNS(NS, "g");
                g.setAttribute("transform", `rotate(${rot} ${x} ${y})`);
                g.setAttribute("class", "bone");
                const line = document.createElementNS(NS, "rect");
                Object.entries({ x: x - 2.5, y: y - 16, width: 5, height: 32, fill: color }).forEach(([a, v]) => line.setAttribute(a, v));
                g.append(line);
                for (const [dx, dy] of [[-3, -17], [3, -17], [-3, 17], [3, 17]]) {
                    const c = document.createElementNS(NS, "circle");
                    Object.entries({ cx: x + dx, cy: y + dy, r: 3.6, fill: color }).forEach(([a, v]) => c.setAttribute(a, v));
                    g.append(c);
                }
                overlay.append(g);
            });
            // AED connections (ACM updateBodyImage): pads on the chest, its own pulse oximeter and cuff, capnograph at the mouth
            const aed = p.aed || {};
            if (aed.pads) { box(80, 104, 13, 17, COLOR.aed, -10); box(124, 162, 13, 17, COLOR.aed, 20); }
            const ARM = { 2: "leftarm", 3: "rightarm" };
            if (ARM[aed.po]) { const [x, y] = OX[ARM[aed.po]]; box(x, y + 13, 14, 9, COLOR.aed); }
            if (ARM[aed.cuff]) { const [x, y] = SITE_POS[ARM[aed.cuff]][0]; box(x, y + 16, 24, 11, COLOR.aed, ARM[aed.cuff] === "leftarm" ? -12 : 12, 3); }
            if (aed.capno && !p.airwayOral && !p.surgicalAirway) box(117, 58, 12, 6, COLOR.aed, -15);
            // Surgical airway (tube at the neck; a strap across the neck once secured) and the fentanyl lozenge
            if (p.surgicalAirway) {
                if (p.sa?.strapSecure) box(100, 74, 34, 4, COLOR.airway, 0, 2);
                box(100, 74, 10, 8, COLOR.airway);
            }
            if (p.lozenge) dot(84, 57, COLOR.circulation, 4);
            if (p.chestSeal) {
                const r = document.createElementNS(NS, "rect");
                Object.entries({ x: 106, y: 100, width: 18, height: 18, rx: 3, fill: COLOR.seal, stroke: "#000" }).forEach(([a, v]) => r.setAttribute(a, v));
                overlay.append(r);
            }
            const tags = [p.cbrn?.ppe?.mask ? "Mask" : "", p.airwayNasal === "NPA" ? "NPA" : "", p.airwayOral === "SGA" ? "i-gel" : p.airwayOral].filter(Boolean);
            tags.forEach((t, k) => {
                if (t !== "Mask") box(100, 42 + k * 15, t.length * 8 + 6, 13, COLOR.airway, 0, 3); // airway items in ACM's airway colour
                const tx = document.createElementNS(NS, "text");
                Object.entries({ x: 100, y: 46 + k * 15, "text-anchor": "middle", class: "icon-label" }).forEach(([a, v]) => tx.setAttribute(a, v));
                tx.textContent = t;
                overlay.append(tx);
            });
        },
    };
}
