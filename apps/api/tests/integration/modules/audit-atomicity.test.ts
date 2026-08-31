/**
 * Integration test for the audit-write invariant on the MONEY modules.
 *
 * The rule (CLAUDE.md): every mutation writes its `audit_logs` row in the SAME
 * transaction. Operating expenses, payroll and repair-spend sign-off used to issue the
 * mutation and the audit row as two independent statements, so a failing audit write
 * left the money change committed with no record of who made it — the ledger gains an
 * entry nobody owns. Wrapping both in one transaction is the fix; this proves it.
 *
 * How the failure is forced: a temporary BEFORE INSERT trigger on audit_logs that always
 * raises. That is the only way to fail the audit write ALONE — a bogus meta.userId would
 * trip the same users(id) FK on the money row first (operating_expenses.created_by is
 * NOT NULL REFERENCES users(id)), so it could never isolate the audit step.
 *
 * Requires PostgreSQL with migrations applied.
 *   Start test DB:  docker compose -f infra/docker-compose.test.yml up -d
 *   Run migrations: DATABASE_URL=postgresql://lsp:lsp@localhost:5433/lsp_test npm run db:migrate
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'kysely';
import { db, pool } from '../../../src/config/db.js';
import { OperatingExpensesRepository } from '../../../src/modules/operating-expenses/operating-expenses.repository.js';
import { PayrollRepository } from '../../../src/modules/payroll/payroll.repository.js';

let userId = '';
const meta = () => ({ userId, ip: '127.0.0.1', requestId: null });

// Unique per run so a re-run against a dirty DB can still tell its own rows apart.
const TAG = `audit-atomicity-${Date.now()}`;

/** Make every audit_logs insert fail, as if the audit write hit an error. */
async function breakAuditWrites() {
  await sql`
    CREATE OR REPLACE FUNCTION lsp_test_block_audit() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'audit write failed (test)'; END;
    $$ LANGUAGE plpgsql;
  `.execute(db);
  await sql`
    CREATE TRIGGER lsp_test_block_audit_trg BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION lsp_test_block_audit();
  `.execute(db);
}

async function restoreAuditWrites() {
  await sql`DROP TRIGGER IF EXISTS lsp_test_block_audit_trg ON audit_logs`.execute(db);
  await sql`DROP FUNCTION IF EXISTS lsp_test_block_audit()`.execute(db);
}

beforeAll(async () => {
  const role = await db
    .selectFrom('roles')
    .select('id')
    .where('name', '=', 'admin')
    .executeTakeFirstOrThrow();

  const user = await db
    .insertInto('users')
    .values({
      role_id: role.id,
      name: 'Audit Atomicity Test',
      email: `audit-atomicity-${Date.now()}@lsp.test`,
      password_hash: 'not-used',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  userId = user.id;
});

// Never leave the trigger installed — it would fail every later suite on this database.
afterEach(restoreAuditWrites);

afterAll(async () => {
  await restoreAuditWrites();
  await db.deleteFrom('operating_expenses').where('description', 'like', `${TAG}%`).execute();
  await db.deleteFrom('staff_compensation').where('user_id', '=', userId).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
  await pool.end();
});

describe('audit writes are atomic with the mutation they record', () => {
  it('rolls the operating expense back when its audit row cannot be written', async () => {
    const repo = new OperatingExpensesRepository(db);
    const description = `${TAG} rolled back`;
    await breakAuditWrites();

    await expect(
      repo.create(
        {
          property_id: null,
          category: 'UTILITIES',
          description,
          vendor: 'Test Vendor',
          amount: 250_00,
          currency: 'BWP',
          incurred_on: new Date('2026-01-15T00:00:00Z'),
          created_by: userId,
          updated_by: userId,
        },
        meta(),
      ),
    ).rejects.toThrow();

    // The point of the whole fix: no orphan cost row survives the failed audit.
    const orphan = await db
      .selectFrom('operating_expenses')
      .select('id')
      .where('description', '=', description)
      .executeTakeFirst();
    expect(orphan).toBeUndefined();
  });

  it('commits the expense and its audit row together when the audit write succeeds', async () => {
    const repo = new OperatingExpensesRepository(db);
    const description = `${TAG} committed`;

    const created = await repo.create(
      {
        property_id: null,
        category: 'UTILITIES',
        description,
        vendor: 'Test Vendor',
        amount: 250_00,
        currency: 'BWP',
        incurred_on: new Date('2026-01-15T00:00:00Z'),
        created_by: userId,
        updated_by: userId,
      },
      meta(),
    );
    expect(created?.id).toBeTruthy();

    const audit = await db
      .selectFrom('audit_logs')
      .select(['action', 'entity'])
      .where('entity', '=', 'operating_expense')
      .where('entity_id', '=', created!.id)
      .executeTakeFirst();
    expect(audit).toMatchObject({ action: 'CREATE', entity: 'operating_expense' });
  });

  it('rolls a salary change back when its audit row cannot be written', async () => {
    const repo = new PayrollRepository(db);
    await breakAuditWrites();

    await expect(
      repo.upsert(
        userId,
        {
          job_title: 'Test Role',
          gross_amount: 5_000_00,
          frequency: 'MONTHLY',
          payment_method: 'BANK',
          active: true,
        },
        meta(),
      ),
    ).rejects.toThrow();

    // A pay rate that landed with no record of who set it is the worst version of this
    // bug, because the audit trail is the only history staff_compensation keeps.
    const orphan = await db
      .selectFrom('staff_compensation')
      .select('user_id')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    expect(orphan).toBeUndefined();
  });
});
