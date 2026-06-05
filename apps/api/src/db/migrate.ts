import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';

const { Client } = pkg;
const require = createRequire(import.meta.url);
const { migrate } = require('postgres-migrations');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgresql://lsp:lsp@localhost:5432/lsp_dev';

const migrationsDir = path.resolve(__dirname, 'migrations');

async function run() {
  console.log('Running migrations from:', migrationsDir);

  // postgres-migrations@5 accepts `{ client }` or discrete connection fields —
  // it does NOT accept `{ connectionString }`. Connect a pg client and pass it.
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await migrate({ client }, migrationsDir);
    console.log('✓ Migrations complete');
  } finally {
    await client.end();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
