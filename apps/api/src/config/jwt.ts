import fs from 'fs';
import path from 'path';
import { env } from './env.js';

/**
 * Resolve a key from an inline PEM env var first (serverless: no key file on disk),
 * falling back to a file path (local dev). Env vars often store the PEM with literal
 * "\n" sequences, so we normalise those back to real newlines.
 */
function resolveKey(inline: string | undefined, filePath: string | undefined, label: string): string {
  if (inline && inline.trim()) {
    return inline.includes('\\n') ? inline.replace(/\\n/g, '\n') : inline;
  }
  if (filePath) {
    const resolved = path.resolve(process.cwd(), filePath);
    if (fs.existsSync(resolved)) return fs.readFileSync(resolved, 'utf-8');
    throw new Error(`JWT ${label} key file not found: ${resolved}`);
  }
  throw new Error(`No JWT ${label} key configured (set JWT_${label.toUpperCase()}_KEY or JWT_${label.toUpperCase()}_KEY_PATH)`);
}

export const jwtKeys = {
  get privateKey() {
    return resolveKey(env.JWT_PRIVATE_KEY, env.JWT_PRIVATE_KEY_PATH, 'private');
  },
  get publicKey() {
    return resolveKey(env.JWT_PUBLIC_KEY, env.JWT_PUBLIC_KEY_PATH, 'public');
  },
};
