// Vercel serverless entry for the LSP API (used when the API is deployed as its own
// Vercel project with Root Directory = apps/api). An Express app is itself a
// (req, res) handler and deliberately does NOT call listen() — see ../src/app.ts.
// The always-on server (../src/server.ts) is for local dev / any persistent host.
import app from '../src/app.js';

export default app;
