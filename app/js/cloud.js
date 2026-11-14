// Firebase access for sessions, sign-in and saved history. Loaded only by pages that need it, so solo practice keeps
// working offline and without Firebase. Discord sign-in goes through the Cloudflare worker (worker/src/index.js),
// which returns a Firebase custom token in the URL fragment.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut as fbSignOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
    getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection, onSnapshot, serverTimestamp, query, where, orderBy, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, authWorkerUrl } from "../firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { doc, getDoc, setDoc, updateDoc, addDoc, collection, onSnapshot, serverTimestamp, query, where, orderBy, limit, getDocs };

/** Resolves with the current user once Firebase has restored the session (or null). */
export const ready = new Promise((resolve) => { const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); }); });
export const onUser = (fn) => onAuthStateChanged(auth, fn);

/** Finishes a Discord sign-in if the worker sent us back with a token. Returns { name } or { error } or null. */
export async function completeDiscordSignIn() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.has("acmt_token") && !h.has("acmt_error")) return null;
    history.replaceState(null, "", location.pathname + location.search); // keep the token out of the address bar and history
    if (h.has("acmt_error")) return { error: h.get("acmt_error") };
    try {
        await signInWithCustomToken(auth, h.get("acmt_token"));
        try { localStorage.setItem("acmt.discordName", h.get("acmt_name") || ""); } catch { /* storage blocked */ }
        return { name: h.get("acmt_name") };
    } catch (e) { return { error: e.code || "sign-in failed" }; }
}
export function discordSignIn() {
    location.href = `${authWorkerUrl}/login?return=${encodeURIComponent(location.href.split("#")[0])}`;
}
export async function signInGuest() { return (auth.currentUser || (await signInAnonymously(auth)).user); }
export const signOut = () => fbSignOut(auth);
export const isDiscord = (u) => !!u && u.uid.startsWith("discord:");
export function displayName(u) {
    if (!u) return "";
    try { return localStorage.getItem("acmt.discordName") || u.uid; } catch { return u.uid; }
}
export async function isInstructor(u) {
    if (!isDiscord(u)) return false;
    try { return (await getDoc(doc(db, "instructors", u.uid))).exists(); } catch { return false; }
}

/** Session code: 6 characters without look-alikes (no 0/O, 1/I/L). */
export function newCode() {
    const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const r = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(r, (x) => abc[x % abc.length]).join("");
}
