import fs from 'fs';
import path from 'path';
import { env } from './env.js';

function loadKey(relativePath: string): string {
  const resolved = path.resolve(process.cwd(), relativePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Key file not found: ${resolved}`);
  }
  return fs.readFileSync(resolved, 'utf-8');
}

export const jwtKeys = {
  get privateKey() {
    return loadKey(env.JWT_PRIVATE_KEY_PATH);
  },
  get publicKey() {
    return loadKey(env.JWT_PUBLIC_KEY_PATH);
  },
};
