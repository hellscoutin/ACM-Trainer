// ACM Trainer sign-in worker: Discord OAuth2 -> Firebase custom token (keeps Firebase on the free Spark plan).
//
// GET /login?return=<app page URL>   redirects to Discord (scope: identify)
// GET /callback?code=&state=          exchanges the code, reads the Discord user, mints a Firebase custom token and
//                                     redirects back to the app page with #acmt_token=<token>&acmt_name=<name>
//
// Secrets (wrangler secret put): DISCORD_CLIENT_SECRET, FIREBASE_SERVICE_ACCOUNT (the service account JSON).
// Vars (wrangler.toml): DISCORD_CLIENT_ID, ALLOWED_ORIGINS (comma-separated origins the app may return to).
// Nothing is stored: the worker keeps no database and logs no tokens.

const DISCORD = "https://discord.com/api/v10";
const AUD = "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";
const STATE_MAX_AGE = 600; // s

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s) => b64url(enc.encode(s));
const fromB64url = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

async function hmac(key, data) {
    const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return b64url(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
function allowedReturn(env, url) {
    try {
        const u = new URL(url);
        return (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean).includes(u.origin) ? u : null;
    } catch { return null; }
}
function page(status, text) {
    return new Response(`<!doctype html><meta charset="utf-8"><title>ACM Trainer sign-in</title><body style="font:16px sans-serif;background:#1b1d1f;color:#f2f2f2;padding:40px"><h1>ACM Trainer sign-in</h1><p>${text}</p></body>`,
        { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** Firebase custom token (RS256 JWT signed with the service account key). */
async function customToken(sa, uid, claims) {
    const now = Math.floor(Date.now() / 1000);
    const header = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = b64urlText(JSON.stringify({ iss: sa.client_email, sub: sa.client_email, aud: AUD, iat: now, exp: now + 3600, uid, claims }));
    const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${payload}`));
    return `${header}.${payload}.${b64url(sig)}`;
}

export default {
    async fetch(request, env) {
        try { return await handle(request, env); }
        catch (e) { console.log("unhandled:", e.name, e.message); return page(500, `Sign-in failed (${e.name}). Please try again; if it keeps happening, tell the site owner.`); }
    },
};

async function handle(request, env) {
    {
        const url = new URL(request.url);
        const redirectUri = `${url.origin}/callback`;
        if (!env.DISCORD_CLIENT_SECRET || !env.FIREBASE_SERVICE_ACCOUNT) return page(503, "Sign-in is not configured yet (the worker secrets are missing).");

        if (url.pathname === "/login") {
            const ret = allowedReturn(env, url.searchParams.get("return") || "");
            if (!ret) return page(400, "This page is not allowed to sign in here.");
            const body = b64urlText(JSON.stringify({ r: ret.href, n: crypto.randomUUID(), t: Math.floor(Date.now() / 1000) }));
            const state = `${body}.${await hmac(env.DISCORD_CLIENT_SECRET, body)}`;
            const q = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: "identify", state, prompt: "none" });
            return Response.redirect(`https://discord.com/oauth2/authorize?${q}`, 302);
        }

        if (url.pathname === "/callback") {
            const [body, sig] = (url.searchParams.get("state") || "").split(".");
            if (!body || !sig || sig !== (await hmac(env.DISCORD_CLIENT_SECRET, body))) return page(400, "Sign-in failed (bad state). Please try again.");
            let st;
            try { st = JSON.parse(fromB64url(body)); } catch { return page(400, "Sign-in failed (bad state)."); }
            if (Math.floor(Date.now() / 1000) - st.t > STATE_MAX_AGE) return page(400, "Sign-in took too long. Please try again.");
            const ret = allowedReturn(env, st.r);
            if (!ret) return page(400, "This page is not allowed to sign in here.");
            const code = url.searchParams.get("code");
            if (!code) return Response.redirect(`${ret.href.split("#")[0]}#acmt_error=cancelled`, 302);

            const tok = await fetch(`${DISCORD}/oauth2/token`, {
                method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: redirectUri }),
            });
            if (!tok.ok) return page(502, "Discord did not accept the sign-in. Please try again.");
            const { access_token } = await tok.json();
            const me = await fetch(`${DISCORD}/users/@me`, { headers: { authorization: `Bearer ${access_token}` } });
            if (!me.ok) return page(502, "Could not read your Discord profile.");
            const user = await me.json();
            const name = user.global_name || user.username || "Discord user";
            // The service account secret: tolerate a byte-order mark or surrounding whitespace from how it was pasted or piped
            let sa;
            try {
                sa = JSON.parse(String(env.FIREBASE_SERVICE_ACCOUNT).replace(/^﻿/, "").trim());
                if (typeof sa === "string") sa = JSON.parse(sa); // stored as a JSON string of the JSON
            } catch (e) {
                console.log("service account parse failed:", e.name, "length", String(env.FIREBASE_SERVICE_ACCOUNT).length, "starts", JSON.stringify(String(env.FIREBASE_SERVICE_ACCOUNT).slice(0, 2)));
                return page(500, "Sign-in is misconfigured: the FIREBASE_SERVICE_ACCOUNT secret is not valid JSON. Set it again from the downloaded key file.");
            }
            if (!sa.client_email || !sa.private_key) {
                console.log("service account fields missing:", Object.keys(sa).join(","));
                return page(500, "Sign-in is misconfigured: the FIREBASE_SERVICE_ACCOUNT secret has no client_email or private_key.");
            }
            sa.private_key = sa.private_key.replace(/\\n/g, "\n");
            let token;
            try { token = await customToken(sa, `discord:${user.id}`, { provider: "discord", name }); }
            catch (e) {
                console.log("custom token failed:", e.name, e.message);
                return page(500, "Sign-in is misconfigured: the service account private key could not be used.");
            }
            const frag = new URLSearchParams({ acmt_token: token, acmt_name: name });
            return Response.redirect(`${ret.href.split("#")[0]}#${frag}`, 302);
        }

        return page(404, "Nothing here. Open the ACM Trainer and use its sign-in button.");
    }
}
