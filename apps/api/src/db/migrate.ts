import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { migrate } = require('postgres-migrations');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = {
  database: process.env['DATABASE_URL'] ?? 'postgresql://lsp:lsp@localhost:5432/lsp_dev',
};

const migrationsDir = path.resolve(__dirname, 'migrations');

async function run() {
  console.log('Running migrations from:', migrationsDir);
  await migrate({ connectionString: config.database }, migrationsDir);
  console.log('✓ Migrations complete');
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
