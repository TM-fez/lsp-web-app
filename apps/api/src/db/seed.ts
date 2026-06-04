/**
 * Development seed: creates one admin user for initial login.
 * Never run against production.
 */
import pkg from 'pg';
import bcrypt from 'bcryptjs';

const { Client } = pkg;

const client = new Client({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://lsp:lsp@localhost:5432/lsp_dev',
});

async function run() {
  await client.connect();

  const { rows: [adminRole] } = await client.query(
    `SELECT id FROM roles WHERE name = 'admin'`
  );

  if (!adminRole) {
    console.error('Roles not seeded yet. Run migrations first.');
    process.exit(1);
  }

  const hash = await bcrypt.hash('Admin@123!', 12);

  await client.query(
    `INSERT INTO users (role_id, name, email, password_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING`,
    [adminRole.id, 'System Admin', 'admin@lsp.local', hash]
  );

  console.log('✓ Seed complete');
  console.log('  Email:    admin@lsp.local');
  console.log('  Password: Admin@123!');
  console.log('  → Change this password immediately after first login.');

  await client.end();
  process.exit(0);
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
