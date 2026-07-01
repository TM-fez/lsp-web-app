import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { AppError } from '../errors/AppError.js';

/**
 * The one shared Claude/LLM client (Phase 2 infrastructure). The AI features that
 * follow — target marketing (A4), the strategy engine (A5), OTA→direct nudges (A6) —
 * all call through here, so swapping models or providers touches only this file
 * (mirrors core/email/email.service.ts).
 *
 * DARK until keyed: with ANTHROPIC_API_KEY unset, `isLlmConfigured()` is false and
 * `generateText()` throws a clear error rather than hitting the API. This is a seam,
 * not a feature — no product code calls it yet.
 */

/** True once an Anthropic API key is configured. */
export function isLlmConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

// Lazily constructed so importing this module never requires a key (tests, cron,
// any deploy that leaves the LLM dark). Reused across calls once built.
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!isLlmConfigured()) {
    throw AppError.badRequest('Claude/LLM is not configured. Set ANTHROPIC_API_KEY.');
  }
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export interface GenerateTextOptions {
  /** The user turn — the actual request/content. */
  prompt: string;
  /** Optional system prompt to steer tone/role. */
  system?: string;
  /** Output ceiling; defaults to ANTHROPIC_MAX_TOKENS. */
  maxTokens?: number;
  /** Override the model per call; defaults to ANTHROPIC_MODEL (claude-opus-4-8). */
  model?: string;
}

/**
 * Single-shot text generation — the common case for the AI features (a campaign
 * blurb, a summary, a suggestion). Returns the concatenated text of the response.
 *
 * Deliberately minimal: no tools, streaming, or extended thinking yet. Consumers
 * that need those can extend this seam without re-plumbing the client.
 */
export async function generateText(opts: GenerateTextOptions): Promise<string> {
  const anthropic = getClient();

  const message = await anthropic.messages.create({
    model: opts.model ?? env.ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens ?? env.ANTHROPIC_MAX_TOKENS,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content: opts.prompt }],
  });

  // content is a block union; keep only the text blocks (ignore any others).
  return message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();
}
