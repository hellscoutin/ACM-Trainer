// Body diagram built from the game's own images, stacked as ACE's BodyImage control group does:
// ACE medical_gui (background, six tinted parts, selection outlines, bones, leg tourniquets; GPL-2.0, ACE3 team)
// and ACM_gui (device overlays and arm tourniquets). Every image shares one 512 x 512 frame.
// Arma tints a picture with colorText (texture x colour); here the image is both the mask and a multiplied background.
// Viewed from the front: the patient's left side is on the right.
const ACE = "assets/ace/body/";
const ACM = "assets/acm/body/";
const ORDER = ["head", "body", "leftarm", "rightarm", "leftleg", "rightleg"];
const ACE_NAME = { head: "head", body: "torso", leftarm: "arm_left", rightarm: "arm_right", leftleg: "leg_left", rightleg: "leg_right" };
const NAMES = { head: "Head", body: "Torso", leftarm: "Left Arm", rightarm: "Right Arm", leftleg: "Left Leg", rightleg: "Right Leg" };
const LIMBS = ["leftarm", "rightarm", "leftleg", "rightleg"];
// colorText values from ACE medical_gui gui.hpp and ACM_gui gui.hpp
const COLOR = {
    airway: "rgb(48,232,237)", circulation: "rgb(51,166,51)", aed: "rgb(46,153,245)", seal: "rgb(255,242,0)", pulseOx: "rgb(77,204,204)",
    tourniquet: "rgb(0,0,204)", splinted: "rgb(0,0,255)", fractured: "rgb(255,0,0)", outline: "rgb(255,255,255)",
};
// ACE_Medical_Menu SelectHead ... SelectLegRight buttons, as fractions of the body image (x, y, w, h)
const ZONES = {
    head: [0.4436, 0.0381, 0.1135, 0.146], body: [0.4112, 0.1841, 0.1784, 0.3082],
    leftarm: [0.5896, 0.1922, 0.0892, 0.3731], rightarm: [0.322, 0.1922, 0.0892, 0.3731],
    leftleg: [0.5004, 0.4923, 0.0892, 0.4704], rightleg: [0.4112, 0.4923, 0.0892, 0.4704],
};

export function createBody(container, onSelect) {
    const fig = document.createElement("div");
    fig.className = "body-fig";
    fig.setAttribute("role", "group");
    fig.setAttribute("aria-label", "Body parts");
    const layers = {};
    const layer = (key, src, color) => {
        const d = document.createElement("div");
        d.className = "body-layer";
        const url = `url("${src}")`; // set inline: a url() inside a CSS variable would resolve against the stylesheet
        d.style.backgroundImage = url;
        d.style.maskImage = url;
        d.style.webkitMaskImage = url;
        if (color) d.style.backgroundColor = color;
        d.hidden = true;
        fig.append(d);
        layers[key] = d;
        return d;
    };
    const bg = document.createElement("img");
    bg.className = "body-bg";
    bg.src = `${ACE}background.png`;
    bg.alt = "";
    fig.append(bg);
    // Same stacking order as the control group: parts, bones, ACM overlays, tourniquets, selection outlines
    for (const id of ORDER) layer(`part_${id}`, `${ACE}${ACE_NAME[id]}.png`, "#fff").hidden = false;
    for (const id of LIMBS) layer(`bone_${id}`, `${ACE}${ACE_NAME[id]}_b.png`);
    layer("seal", `${ACM}torso_chestseal.png`, COLOR.seal);
    for (const k of ["opa", "npa", "igel", "surgical_airway_0", "surgical_airway_1"]) layer(k, `${ACM}head_${k}.png`, COLOR.airway);
    layer("lozenge", `${ACM}head_lozenge.png`, COLOR.circulation);
    for (const id of ["leftarm", "rightarm"]) layer(`pulseox_${id}`, `${ACM}${id}_pulseoximeter.png`, COLOR.pulseOx);
    layer("aed_pads", `${ACM}torso_aed_pads.png`, COLOR.aed);
    layer("aed_capno", `${ACM}head_aed_capnograph.png`, COLOR.aed);
    for (const id of ["leftarm", "rightarm"]) {
        layer(`aed_po_${id}`, `${ACM}${id}_aed_pulseoximeter.png`, COLOR.aed);
        layer(`aed_cuff_${id}`, `${ACM}${id}_aed_pressurecuff.png`, COLOR.aed);
    }
    layer("io_body", `${ACM}torso_fast_io.png`, COLOR.circulation);
    for (const id of LIMBS) {
        layer(`io_${id}`, `${ACM}${id}_io.png`, COLOR.circulation);
        for (const site of ["upper", "middle", "lower"]) layer(`iv_${id}_${site}`, `${ACM}${id}_iv_${site}.png`, COLOR.circulation);
    }
    for (const id of ["leftarm", "rightarm"]) layer(`cuff_${id}`, `${ACM}${id}_aed_pressurecuff.png`, COLOR.circulation);
    for (const id of LIMBS) layer(`tq_${id}`, id.endsWith("arm") ? `${ACM}${id}_tourniquet.png` : `${ACE}${ACE_NAME[id]}_t.png`, COLOR.tourniquet);
    for (const id of ORDER) layer(`sel_${id}`, `${ACE}${ACE_NAME[id]}_s.png`, COLOR.outline).classList.add("body-sel");

    const side = (cls, t) => { const s = document.createElement("span"); s.className = `body-side ${cls}`; s.textContent = t; s.setAttribute("aria-hidden", "true"); fig.append(s); };
    side("r", "R"); side("l", "L");
    const mask = document.createElement("span");
    mask.className = "body-tag";
    mask.hidden = true;
    mask.textContent = "Gas mask";
    fig.append(mask);

    const zones = {};
    for (const id of ORDER) {
        const [x, y, w, h] = ZONES[id];
        const b = document.createElement("button");
        b.type = "button";
        b.className = "body-zone";
        b.title = `Select ${NAMES[id]}`;
        b.setAttribute("aria-label", NAMES[id]);
        Object.assign(b.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` });
        b.addEventListener("click", () => onSelect(id));
        b.addEventListener("pointerenter", () => layers[`sel_${id}`].classList.add("hover"));
        b.addEventListener("pointerleave", () => layers[`sel_${id}`].classList.remove("hover"));
        fig.append(b);
        zones[id] = b;
    }
    container.append(fig);
    const show = (key, on) => { layers[key].hidden = !on; };

    return {
        update(colors, selected, p) {
            const aed = p.aed || {};
            ORDER.forEach((id, i) => {
                layers[`part_${id}`].style.backgroundColor = colors[i];
                show(`sel_${id}`, true);
                layers[`sel_${id}`].classList.toggle("on", id === selected);
                zones[id].setAttribute("aria-pressed", String(id === selected));
                if (!LIMBS.includes(id)) return;
                show(`tq_${id}`, (p.tourniquets?.[i] || 0) > 0);
                // ACM updateBodyImage: bone blue with a splint on, red when fractured (showFracture, on by default)
                const splinted = p.splints ? p.splints[i] > 0 : p.fractures?.[i] === -1 && p.splintBone;
                const fractured = p.fractures?.[i] === 1;
                show(`bone_${id}`, splinted || fractured);
                layers[`bone_${id}`].style.backgroundColor = splinted ? COLOR.splinted : COLOR.fractured;
                show(`io_${id}`, !!p.ioAccess?.[i]);
                ["upper", "middle", "lower"].forEach((site, s) => show(`iv_${id}_${site}`, !!p.ivAccess?.[i]?.[s]));
            });
            show("io_body", !!p.ioAccess?.[1]);
            ["leftarm", "rightarm"].forEach((id, k) => {
                show(`pulseox_${id}`, !!p.pulseOx?.[k]);
                show(`cuff_${id}`, !!p.pressureCuff?.[k]);
                show(`aed_po_${id}`, aed.po === k + 2);
                show(`aed_cuff_${id}`, aed.cuff === k + 2);
            });
            show("aed_pads", !!aed.pads);
            show("aed_capno", !!aed.capno && !p.airwayOral && !p.surgicalAirway);
            show("surgical_airway_0", !!p.surgicalAirway && !p.sa?.strapSecure);
            show("surgical_airway_1", !!p.surgicalAirway && !!p.sa?.strapSecure);
            show("opa", !!p.airwayOral && p.airwayOral !== "SGA");
            show("igel", p.airwayOral === "SGA");
            show("npa", p.airwayNasal === "NPA");
            show("lozenge", !!p.lozenge);
            show("seal", !!p.chestSeal);
            mask.hidden = !p.cbrn?.ppe?.mask; // no body image exists for the gas mask; the trainer labels it
        },
    };
}
