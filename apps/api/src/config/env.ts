import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_PREFIX: z.string().default('/api/v1'),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  DATABASE_POOL_MAX: z.coerce.number().default(10),

  // Keys can come from a file (local dev) OR inline PEM in an env var (serverless,
  // where there's no key file). jwt.ts prefers the inline value, then the path.
  JWT_PRIVATE_KEY_PATH: z.string().optional(),
  JWT_PUBLIC_KEY_PATH: z.string().optional(),
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  JWT_REFRESH_COOKIE_NAME: z.string().default('lsp_refresh'),

  CORS_ORIGIN: z.string(),

  // How many reverse-proxy hops sit in front of Express, counted from the socket
  // outward (production: 2 — Vercel rewrite → Render edge). Drives `trust proxy`,
  // which is what makes req.ip (rate-limit keys, audit-log IPs) the real client
  // address instead of the proxy's. 0 = trust nothing (local dev: Vite's proxy
  // sends no X-Forwarded-For).
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

  // Shared secret the scheduled sweep endpoint (GET /cron/sweep) requires, so only the
  // platform cron can trigger it. When unset, the endpoint refuses every caller.
  CRON_SECRET: z.string().optional(),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().default(200),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().default(10),
  RATE_LIMIT_REFRESH_MAX: z.coerce.number().default(30),

  // How long an unpaid /stay booking may sit PENDING (blocking its nights) before
  // the sweep auto-cancels it and notifies the property. 0 disables the expiry.
  WEBSITE_PENDING_TTL_HOURS: z.coerce.number().default(24),

  // Background auto-expiry sweep (expired holds + stale quotes).
  // Opt out anywhere with DISABLE_SCHEDULER=1; it is also always off under NODE_ENV=test.
  DISABLE_SCHEDULER: z
    .string()
    .optional()
    .transform((v) => v === '1' || v?.toLowerCase() === 'true'),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./uploads'),
  STORAGE_MAX_FILE_SIZE_MB: z.coerce.number().default(10),
  STORAGE_ALLOWED_MIME_TYPES: z.string().default('image/jpeg,image/png,image/webp,application/pdf'),

  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().optional(),
  STORAGE_S3_ACCESS_KEY: z.string().optional(),
  STORAGE_S3_SECRET_KEY: z.string().optional(),
  STORAGE_S3_ENDPOINT: z.string().optional(),

  BCRYPT_ROUNDS: z.coerce.number().default(12),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Email via Brevo transactional API. Optional — when BREVO_API_KEY or EMAIL_FROM
  // are unset, sending is disabled and the send endpoint returns a clear error.
  BREVO_API_KEY: z.string().optional(),      // Brevo API v3 key (xkeysib-…)
  EMAIL_FROM: z.string().optional(),         // a sender address verified in Brevo
  EMAIL_FROM_NAME: z.string().default('Lifestyle Apartments'),

  // Channel-sync double-booking alerts.
  CHANNEL_ALERT_EMAIL: z.string().optional(), // manager inbox for collision emails (Brevo)
  // WhatsApp seam — built but DARK until a provider template is approved. Even with creds
  // set, sends stay off unless WHATSAPP_LIVE=1, so APPROVAL (not deploy) flips it on.
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_FROM: z.string().optional(),
  WHATSAPP_TO: z.string().optional(),
  WHATSAPP_LIVE: z
    .string()
    .optional()
    .transform((v) => v === '1' || v?.toLowerCase() === 'true'),

  // Claude/LLM (Phase 2 shared infra). Optional — the client is DARK until keyed:
  // with ANTHROPIC_API_KEY unset, isLlmConfigured() is false and callers get a clear
  // error instead of a failed request. Model + token ceiling have sane defaults.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-8'),
  ANTHROPIC_MAX_TOKENS: z.coerce.number().int().positive().default(1024),
});

const result = schema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment configuration:');
  console.error(result.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = result.data;
