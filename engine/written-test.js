// Written tests (ACM Training/Design/MATERIALS-design.md section 6). The question bank is not part of this public
// repo: instructors load the file `questions-bank.json` built by ACM Training (tools/build_materials.py).
// Bank format "acm-training-questions/1": { passMark, testSize: {track: n}, tracks: {track: title},
//   questions: [{ id, track, module, type: "single"|"multi", stem, options: [...], answer: [index...], why, guide }] }
import { makeRng } from "./util.js";

export const BANK_FORMAT = "acm-training-questions/1";

/** Throws with a readable message if the file is not a usable bank. Returns the bank. */
export function validateBank(bank) {
    if (!bank || bank.format !== BANK_FORMAT) throw new Error("This is not an ACM Training question bank (questions-bank.json).");
    if (!Array.isArray(bank.questions) || !bank.questions.length) throw new Error("The question bank has no questions.");
    for (const q of bank.questions) {
        if (!q.id || !q.track || !Array.isArray(q.options) || !Array.isArray(q.answer) || !q.answer.length || q.answer.some((a) => a < 0 || a >= q.options.length))
            throw new Error(`Question ${q.id || "?"} is malformed.`);
    }
    return bank;
}

export const tracksIn = (bank) => Object.entries(bank.tracks || {}).filter(([k]) => bank.questions.some((q) => q.track === k));

function shuffle(list, rnd) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}

/**
 * Draws a test: n questions of a track, spread evenly over its modules, in random order, with shuffled options.
 * Returns [{ id, module, type, stem, options, order }] where order[k] is the bank index of displayed option k.
 * Answers are not included: score() maps them back with the bank.
 */
export function drawTest(bank, track, seed, n = bank.testSize?.[track] ?? 15) {
    const rng = makeRng(seed >>> 0), rnd = () => rng.random();
    const pool = bank.questions.filter((q) => q.track === track);
    if (pool.length < n) throw new Error(`Only ${pool.length} ${track} questions in the bank; a test needs ${n}.`);
    const byMod = {};
    for (const q of shuffle(pool, rnd)) (byMod[q.module] ??= []).push(q);
    const mods = Object.keys(byMod).sort(), picked = [];
    while (picked.length < n) for (const m of mods) if (byMod[m].length && picked.length < n) picked.push(byMod[m].pop());
    return shuffle(picked, rnd).map((q) => {
        const order = shuffle(q.options.map((_, i) => i), rnd);
        return { id: q.id, module: q.module, type: q.type, stem: q.stem, options: order.map((i) => q.options[i]), order };
    });
}

/**
 * Scores answers. test: drawTest output; answers: { questionId: [displayed option index...] }.
 * A multi-answer question scores only when exactly the right options are chosen.
 */
export function scoreTest(bank, test, answers) {
    const byId = Object.fromEntries(bank.questions.map((q) => [q.id, q]));
    const items = test.map((t) => {
        const q = byId[t.id];
        if (!q) return { id: t.id, correct: false, missing: true };
        const chosen = (answers[t.id] || []).map((k) => t.order[k]).sort((a, b) => a - b);
        const right = q.answer.slice().sort((a, b) => a - b);
        const correct = chosen.length === right.length && chosen.every((v, i) => v === right[i]);
        return { id: q.id, module: q.module, correct, chosen, right, stem: q.stem, options: q.options, why: q.why, guide: q.guide };
    });
    const got = items.filter((i) => i.correct).length;
    const passMark = bank.passMark ?? 0.8;
    const need = Math.round(test.length * passMark);
    return { got, total: test.length, need, passed: got >= need, score: test.length ? got / test.length : 0, items };
}
