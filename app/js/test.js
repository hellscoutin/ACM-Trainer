// Written test page. Solo: load the question bank file, pick a track, answer, see the score and a review with the
// guide chapter for every question; the result goes into the practice records. Session (?session=CODE): the
// instructor's round carries the questions (no answers); answers go to the trainee's run and the instructor scores them.
import { validateBank, tracksIn, drawTest, scoreTest } from "../../engine/written-test.js";
import { addRecord, loadBankRaw, saveBank } from "./store.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
const params = new URLSearchParams(location.search);
const code = (params.get("session") || "").toUpperCase();
const LETTERS = "ABCDE";

function loadBank() { try { const b = loadBankRaw(); return b ? validateBank(b) : null; } catch { return null; } }

/** Renders the questions as a form; returns a function that reads the answers { id: [displayed index...] }. */
function renderQuestions(test, onChange) {
    const box = $("questions");
    box.textContent = "";
    for (const q of test) {
        const name = `q_${q.id}`;
        const opts = q.options.map((o, k) => el("label", { className: "opt" }, el("input", { type: q.type === "multi" ? "checkbox" : "radio", name, value: String(k) }), el("span", { className: "letter", textContent: LETTERS[k] }), el("span", { textContent: o })));
        box.append(el("li", { className: "question" }, el("p", { className: "stem", textContent: q.stem + (q.type === "multi" ? " (choose all that apply)" : "") }), el("div", { className: "opts" }, ...opts)));
    }
    const read = () => Object.fromEntries(test.map((q) => [q.id, [...document.querySelectorAll(`input[name="q_${q.id}"]:checked`)].map((i) => Number(i.value))]));
    box.addEventListener("change", () => onChange(read()));
    onChange(read());
    return read;
}

function answeredCount(test, answers) { return test.filter((q) => answers[q.id]?.length).length; }

function renderResult(res, extra = "") {
    $("result").hidden = false;
    $("scoreBox").className = `score-box ${res.passed ? "pass" : "fail"}`;
    $("scoreBox").textContent = "";
    $("scoreBox").append(el("div", { className: "big", textContent: `${res.got} / ${res.total}` }),
        el("div", { textContent: `${res.passed ? "PASS" : "NOT PASSED"} · pass mark ${res.need} of ${res.total}${extra}` }));
    const box = $("review");
    box.textContent = "";
    for (const it of [...res.items].sort((a, b) => a.correct - b.correct)) {
        const li = el("li", { className: it.correct ? "ok" : "bad" }, el("p", { className: "stem", textContent: `${it.correct ? "✓" : "✗"} ${it.stem}` }));
        li.append(el("ul", {}, ...it.options.map((o, i) => el("li", { className: it.right.includes(i) ? "right" : it.chosen.includes(i) ? "wrong" : "", textContent: `${o}${it.right.includes(i) ? "  (correct)" : it.chosen.includes(i) ? "  (your answer)" : ""}` }))));
        li.append(el("p", { className: "why", textContent: `${it.why} Guide: ${it.guide}.` }));
        box.append(li);
    }
}

// ------------------------------------------------------------------ solo
function solo() {
    $("setup").hidden = false;
    let bank = loadBank();
    const showBank = () => {
        $("bankStatus").textContent = bank ? `Loaded: ${bank.questions.length} questions (ACM ${bank.acm || "?"})` : "No bank loaded.";
        $("trackBox").hidden = !bank;
        if (!bank) return;
        $("track").textContent = "";
        for (const [k, title] of tracksIn(bank)) $("track").append(el("option", { value: k, textContent: `${title} (${bank.testSize?.[k] ?? 15} questions)` }));
    };
    showBank();
    $("bankFile").addEventListener("change", async () => {
        const f = $("bankFile").files[0];
        if (!f) return;
        try { bank = validateBank(JSON.parse(await f.text())); saveBank(bank); showBank(); } catch (e) { $("bankStatus").textContent = e.message; }
    });
    $("startBtn").addEventListener("click", () => {
        const track = $("track").value, seed = Math.floor(Math.random() * 1e9);
        let test;
        try { test = drawTest(bank, track, seed); } catch (e) { $("status").textContent = e.message; return; }
        $("setup").hidden = true;
        $("title").textContent = `${bank.tracks[track]} written test`;
        $("test").hidden = false;
        $("testInfo").textContent = `${test.length} questions · pass mark ${Math.round(test.length * (bank.passMark ?? 0.8))} correct · one answer unless the question says otherwise`;
        const started = Date.now();
        const read = renderQuestions(test, (a) => { $("answered").textContent = `${answeredCount(test, a)} of ${test.length} answered`; });
        $("test").addEventListener("submit", (e) => {
            e.preventDefault();
            const answers = read();
            if (answeredCount(test, answers) < test.length && !confirm("Some questions are unanswered. Submit anyway?")) return;
            const res = scoreTest(bank, test, answers);
            $("test").hidden = true;
            renderResult(res);
            addRecord({ date: new Date().toISOString(), scenario: `test-${track}`, module: "Written test", title: `${bank.tracks[track]} written test`, role: "", seed,
                result: res.passed ? "GO" : "NO-GO", score: Math.round(res.score * 100), outcome: `${res.got}/${res.total} correct`, duration: Math.round((Date.now() - started) / 1000),
                criticalFails: [], failedChecks: res.items.filter((i) => !i.correct).map((i) => i.id), hints: "Off" });
        });
    });
}

// ------------------------------------------------------------------ session
async function session() {
    const { db, doc, getDoc, setDoc, onSnapshot, serverTimestamp, ready, signInGuest } = await import("./cloud.js");
    const user = (await ready) || (await signInGuest());
    const sref = doc(db, "sessions", code), rref = doc(db, "sessions", code, "runs", user.uid);
    const run = (await getDoc(rref)).data();
    if (!run) { location.href = `join.html?code=${code}`; return; }
    let s = (await getDoc(sref)).data();
    const round = s.round || 1, t = s.scenario?.test;
    if (!t) { location.href = `play.html?session=${code}`; return; }
    $("title").textContent = t.title || "Written test";
    let read = null, submitted = false, shown = false;
    const submit = async (auto) => {
        if (submitted) return;
        const answers = read ? read() : {};
        if (!auto && answeredCount(t.questions, answers) < t.questions.length && !confirm("Some questions are unanswered. Submit anyway?")) return;
        submitted = true;
        $("test").hidden = true;
        $("waiting").hidden = false;
        $("waitText").textContent = "Answers sent. Your instructor has the results.";
        try { await setDoc(rref, { round, status: "ended", title: t.title, module: "Written test", scenarioId: `test-${t.track}`, name: run.name, test: { answers, submittedAt: serverTimestamp(), auto: !!auto } }, { merge: true }); }
        catch (e) { $("status").textContent = `Could not send the answers (${e.code || e.message}). Keep this page open and tell your instructor.`; submitted = false; }
    };
    const show = () => {
        if (shown) return;
        shown = true;
        $("waiting").hidden = true;
        $("test").hidden = false;
        $("testInfo").textContent = `${t.questions.length} questions · session ${code} · ${run.name}`;
        read = renderQuestions(t.questions, (a) => { $("answered").textContent = `${answeredCount(t.questions, a)} of ${t.questions.length} answered`; });
        $("test").addEventListener("submit", (e) => { e.preventDefault(); submit(false); });
        setDoc(rref, { round, status: "running", title: t.title, module: "Written test", scenarioId: `test-${t.track}`, name: run.name }, { merge: true }).catch(() => {});
    };
    $("waiting").hidden = false;
    setDoc(rref, { round, status: "waiting", title: t.title, name: run.name }, { merge: true }).catch(() => {});
    onSnapshot(sref, (d) => {
        s = d.data();
        if (!s) return;
        if ((s.round || 1) !== round) { location.href = s.scenario?.test ? `test.html?session=${code}` : `play.html?session=${code}`; return; }
        if (s.phase === "running" && !submitted) show();
        if (s.phase === "ended" && shown && !submitted) submit(true);
        if (s.status !== "open") $("status").textContent = "The instructor closed the session.";
    });
}

if (code) session().catch((e) => { $("status").textContent = e.message; });
else solo();
