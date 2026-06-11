// Vercel serverless entry for the LSP API.
//
// An Express app is itself a (req, res) handler, so on Vercel we just export the
// configured app — which deliberately does NOT call listen() (see apps/api/src/app.ts).
// The always-on server (apps/api/src/server.ts) is for local dev / any persistent host;
// the auto-expiry sweep runs via the platform cron (GET /api/v1/cron/sweep) here.
import app from '../apps/api/src/app.js';

export default app;
