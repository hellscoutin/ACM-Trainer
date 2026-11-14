// Writes rules/fixtures.json: knowledge views from scripted runs of every built-in scenario with the matching
// rules the JavaScript interpreter returns. The ATAK patient monitor's SQF interpreter must return the same
// (ACM Training/Design/PATIENT-MONITOR-design.md, section 6). Run: node tools/export_guidance_fixtures.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createSession } from "../engine/runner.js";
import { knowledgeView, evaluateView } from "../engine/guidance.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = read("../data/acm-1.4.8.json"), meds = read("../data/medications-1.4.8.json"), rules = read("../rules/guidance.json");
const LEVEL = { anyone: 0, medic: 1, doctor: 2 };

export function buildFixtures() {
    const fixtures = [];
    for (const id of read("../scenarios/index.json").scenarios) {
        const scn = read(`../scenarios/${id}.json`);
        const s = createSession(scn, data, meds, { rubric: { checks: [] } });
        const level = LEVEL[scn.role] ?? 1;
        // a few examinations so the Intermediate findings are exercised, then views at three moments
        s.tick(3);
        for (const [a, part] of [["checkresponse", "head"], ["checkairway", "head"], ["checkbreathing", "head"], ["checkpulse", "head"], ["checkdogtags", "head"]]) s.act(a, part);
        for (const t of [10, 90, 240]) {
            s.until(t);
            if (t === 90) for (const [a, part] of [["inspectchest", "body"], ["checkbloodpressure", "leftarm"], ["usestethoscope", "body"]]) s.act(a, part);
            for (const depth of [1, 2, 3]) {
                const view = knowledgeView(s.sim, depth, { level });
                const clean = Object.fromEntries(Object.entries(view).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v]));
                const expect = evaluateView(rules, clean, { depth, level }).map((g) => [g.id, g.text]);
                fixtures.push({ name: `${id}@${t}s/d${depth}`, depth, level, view: clean, expect });
            }
        }
    }
    return { rulesVersion: rules.version ?? null, count: fixtures.length, fixtures };
}

if (process.argv[1] && process.argv[1].endsWith("export_guidance_fixtures.mjs")) {
    const out = buildFixtures();
    writeFileSync(new URL("../rules/fixtures.json", import.meta.url), JSON.stringify(out) + "\n");
    console.log(`rules/fixtures.json: ${out.count} fixtures, ${out.fixtures.reduce((a, f) => a + f.expect.length, 0)} expected recommendations`);
}
