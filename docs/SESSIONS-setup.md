# Instructor sessions: one-time setup

Instructor-led sessions (step 5) use three services: GitHub Pages (the app), Firebase (sign-in and the live session data) and a Cloudflare Worker (Discord sign-in). Solo practice needs none of them.

## What is already done

- Firestore database `(default)` in `nam5`, with the security rules from `firebase/firestore.rules` deployed (`npx firebase-tools deploy --only firestore:rules --project acm-trainer`).
- Worker `acm-trainer-auth` deployed from `worker/` (`npx wrangler deploy`). Its address is in `app/firebase-config.js` (`authWorkerUrl`).

## Owner checklist

1. **Turn on Firebase Authentication.** Firebase console → acm-trainer → Build → Authentication → Get started. Then Sign-in method → **Anonymous** → Enable. Trainees join sessions anonymously; Discord users sign in with custom tokens, which need no provider switched on.
2. **Service account key for the worker.** Firebase console → Project settings → Service accounts → Generate new private key. Save the file outside the repo. In PowerShell, from the `worker` folder:
   ```
   Get-Content C:\path\to\key.json -Raw | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
   ```
   Then delete the downloaded key file.
3. **Discord client secret.** Discord developer portal → your application → OAuth2 → Reset/Copy secret. From the `worker` folder: `npx wrangler secret put DISCORD_CLIENT_SECRET` and paste it when asked.
4. **Discord redirect.** In the same OAuth2 page, add the redirect `<authWorkerUrl>/callback` (for example `https://acm-trainer-auth.<your-subdomain>.workers.dev/callback`).
5. **Instructors.** Each instructor signs in once on `instructor.html`. The page shows their ID (`discord:` followed by their Discord user ID). Add it in the Firebase console: Firestore → Start collection `instructors` → Document ID = that ID (no fields needed). The rules let only listed instructors create sessions and send commands.

## Changing the worker address

If the workers.dev subdomain changes, update `authWorkerUrl` in `app/firebase-config.js` and the Discord redirect (step 4). `ALLOWED_ORIGINS` in `worker/wrangler.toml` lists the pages that may receive a sign-in (GitHub Pages and the local test server); redeploy the worker after changing it.

## How a session runs

1. The instructor creates a session (scenario, same or different patient, who controls the clock, hints allowed) and gets a 6-character code.
2. Trainees open `join.html`, enter the code and a name, and wait on the briefing.
3. Start, pause, speed and end apply to everyone (session document). Pause, injects, set values, messages and end can also target one trainee (commands collection).
4. Each trainee publishes a snapshot every 2 s (true vitals, alerts, current action, recent actions and a replay frame for the mirror view). At the end the trainee's client writes the scored result to the run and to `results`.
5. "New round" loads another scenario for everyone on the session page. "Export results" downloads a CSV.

Free tier: about 10 trainees for 30 minutes is roughly 9,000 document writes, well within Firestore's daily free quota.
