import { app } from './app.js';
import { env } from './config/env.js';
import { startScheduler } from './core/scheduler.js';

// Long-running entry point (local dev + any always-on host). Serverless platforms
// import `app` directly and never run this file, so the HTTP listener and the
// background sweep scheduler only start here.
const server = app.listen(env.PORT, () => {
  console.log(`[api] listening  → http://localhost:${env.PORT}`);
  console.log(`[api] health     → http://localhost:${env.PORT}/health`);
  console.log(`[api] api prefix → http://localhost:${env.PORT}${env.API_PREFIX}`);
  startScheduler();
});

export { server };
