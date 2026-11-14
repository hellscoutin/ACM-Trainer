// Firebase web configuration for the acm-trainer project.
// This is public by design: access is controlled by the Firestore security rules (firebase/firestore.rules).
export const firebaseConfig = {
    apiKey: "AIzaSyDHhxfMLOAdVDOpLk4j_hcXo_qhD191UkY",
    authDomain: "acm-trainer.firebaseapp.com",
    projectId: "acm-trainer",
    storageBucket: "acm-trainer.firebasestorage.app",
    messagingSenderId: "638420823374",
    appId: "1:638420823374:web:e17b6c2509dffac813821f",
};

// Discord application used for instructor and saved-history sign-in (client ID only; the secret lives in the Cloudflare Worker).
export const discordClientId = "1570937903364702290";

// Cloudflare worker that exchanges a Discord sign-in for a Firebase custom token (worker/src/index.js).
export const authWorkerUrl = "https://acm-trainer-auth.acm-trainer.workers.dev";
