// Browser storage for solo practice: records, custom scenarios and the last few replays. Everything stays in this
// browser (localStorage). Every access is guarded: private windows and blocked storage simply keep nothing.
const KEYS = { records: "acmt.records.v1", custom: "acmt.custom.v1", replays: "acmt.replays.v1" };
const MAX_RECORDS = 1000, MAX_REPLAYS = 3;

function read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const storageOK = (() => { try { localStorage.setItem("acmt.test", "1"); localStorage.removeItem("acmt.test"); return true; } catch { return false; } })();

// ------------------------------------------------------------------ records
export const loadRecords = () => read(KEYS.records, []);
export function addRecord(r) {
    const all = loadRecords();
    all.push(r);
    while (all.length > MAX_RECORDS) all.shift();
    return write(KEYS.records, all);
}
export const clearRecords = () => { write(KEYS.records, []); write(KEYS.replays, []); };

// ------------------------------------------------------------------ custom scenarios
export const loadCustom = () => read(KEYS.custom, {});
export const getCustom = (id) => loadCustom()[id] || null;
export function saveCustom(scn) {
    const all = loadCustom();
    all[scn.id] = scn;
    return write(KEYS.custom, all);
}
export function deleteCustom(id) {
    const all = loadCustom();
    delete all[id];
    return write(KEYS.custom, all);
}
export const newCustomId = () => "custom-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ------------------------------------------------------------------ replays (newest first; dropped when space runs out)
export const loadReplays = () => read(KEYS.replays, []);
export const getReplay = (key) => loadReplays().find((r) => r.key === key) || null;
export function addReplay(replay) {
    const all = [replay, ...loadReplays().filter((r) => r.key !== replay.key)].slice(0, MAX_REPLAYS);
    while (all.length) { if (write(KEYS.replays, all)) return true; all.pop(); }
    return false;
}

/** Offers text as a file download. */
export function download(filename, text, type = "text/plain") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
