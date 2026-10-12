import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { startScheduler } from './core/scheduler.js';
import { reportOverlongStays } from './core/checks/overlongStays.js';
import { db } from './config/db.js';

// Long-running entry point (local dev + any always-on host). Serverless platforms
// import `app` directly and never run this file, so the HTTP listener and the
// background sweep scheduler only start here.
const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, apiPrefix: env.API_PREFIX },
    `[api] listening → http://localhost:${env.PORT}`,
  );
  startScheduler();
  // (Audit H-1 follow-up) Report any booking saved before the stay-length cap existed.
  // Fire-and-forget: a failed check is logged and never stops the API from serving.
  reportOverlongStays(db).catch((err) => logger.error({ err }, '[startup-check] over-long stay check failed'));
});

export { server };
