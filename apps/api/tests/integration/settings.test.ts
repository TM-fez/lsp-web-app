/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (P7) Settings: the business details printed on invoices, the two business rules
 * (payment terms, website hold), and changing your own password — through the real app,
 * real JWTs and the real refresh cookie.
 *
 * app_settings is ONE shared row and other suites run in parallel, so this file never
 * leaves a rule changed: rule reads are proven inside a rolled-back transaction, and the
 * details it does PATCH are put back afterwards.
 */
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../../src/app.js';
import { db } from '../../src/config/db.js';
import { env } from '../../src/config/env.js';
import { companyDetails, invoiceTermsDays, websiteHoldHours } from '../../src/core/settings/appSettings.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'SettingsPass@99!';
const userIds: string[] = [];
let before: { vat_number: string | null; invoice_footer: string | null } | undefined;

async function makeUser(tag: string, role: string): Promise<{ id: string; email: string }> {
  const roleRow = await db.selectFrom('roles').select('id').where('name', '=', role).executeTakeFirstOrThrow();
  const email = `p7-${tag}-${uniq}@lsp.test`;
  const row = await db
    .insertInto('users')
    .values({ role_id: roleRow.id, name: `P7 ${tag}`, email, password_hash: await bcrypt.hash(PASSWORD, 4) })
    .returning('id')
    .executeTakeFirstOrThrow();
  userIds.push(row.id);
  return { id: row.id, email };
}

async function login(email: string, password = PASSWORD) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
}

const me = (token: string) => request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
const changePw = (token: string, body: object) =>
  request(app).post('/api/v1/auth/change-password').set('Authorization', `Bearer ${token}`).send(body);

afterAll(async () => {
  if (before) await db.updateTable('app_settings').set(before).where('id', '=', 1).execute();
  await db.deleteFrom('refresh_tokens').where('user_id', 'in', userIds).execute();
  await db.deleteFrom('audit_logs').where('user_id', 'in', userIds).execute();
  await db.deleteFrom('users').where('id', 'in', userIds).execute();
});

describe('P7 business settings', () => {
  it('admins read and update them; the change is audited and invoices pick it up', async () => {
    const admin = await makeUser('admin', 'admin');
    const token = await login(admin.email);
    before = await db.selectFrom('app_settings').select(['vat_number', 'invoice_footer']).where('id', '=', 1).executeTakeFirstOrThrow();

    const got = await request(app).get('/api/v1/settings').set('Authorization', `Bearer ${token}`);
    expect(got.status).toBe(200);
    expect(got.body.defaults).toEqual({
      company_name: 'Lifestyle Apartments',
      invoice_terms_days: env.INVOICE_TERMS_DAYS,
      website_hold_hours: env.WEBSITE_PENDING_TTL_HOURS,
    });

    const vat = `P7-${uniq}`.slice(0, 40);
    const res = await request(app)
      .patch('/api/v1/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ vat_number: `  ${vat}  `, invoice_footer: '' });
    expect(res.status).toBe(200);
    expect(res.body.vat_number).toBe(vat); // trimmed
    expect(res.body.invoice_footer).toBeNull(); // empty clears

    expect((await companyDetails(db)).vat_number).toBe(vat);
    const audit = await db
      .selectFrom('audit_logs')
      .select(['entity', 'entity_id'])
      .where('user_id', '=', admin.id)
      .where('entity', '=', 'app_settings')
      .executeTakeFirst();
    expect(audit).toEqual({ entity: 'app_settings', entity_id: '1' });
  });

  it('refuses rules out of range and a malformed email', async () => {
    const admin = await makeUser('admin2', 'admin');
    const token = await login(admin.email);
    const patch = (body: object) => request(app).patch('/api/v1/settings').set('Authorization', `Bearer ${token}`).send(body);
    expect((await patch({ invoice_terms_days: 91 })).status).toBe(400);
    expect((await patch({ website_hold_hours: 0 })).status).toBe(400);
    expect((await patch({ company_email: 'not-an-email' })).status).toBe(400);
    // A misspelt field is refused, not silently dropped with a "saved" reply.
    expect((await patch({ invoice_term_days: 14 })).status).toBe(400);
  });

  it('is admin-only — front desk can neither read nor change it', async () => {
    const reception = await makeUser('reception', 'reception');
    const token = await login(reception.email);
    expect((await request(app).get('/api/v1/settings').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    expect((await request(app).patch('/api/v1/settings').set('Authorization', `Bearer ${token}`).send({ vat_number: 'x' })).status).toBe(403);
  });

  it('payment terms and the website hold follow the setting, and fall back to the default when empty', async () => {
    // Rolled back: other suites run in parallel against the same single row.
    await db
      .transaction()
      .execute(async (trx) => {
        await trx.updateTable('app_settings').set({ invoice_terms_days: 14, website_hold_hours: 6 }).where('id', '=', 1).execute();
        expect(await invoiceTermsDays(trx)).toBe(14);
        expect(await websiteHoldHours(trx)).toBe(6);
        await trx.updateTable('app_settings').set({ invoice_terms_days: null, website_hold_hours: null }).where('id', '=', 1).execute();
        expect(await invoiceTermsDays(trx)).toBe(env.INVOICE_TERMS_DAYS);
        expect(await websiteHoldHours(trx)).toBe(env.WEBSITE_PENDING_TTL_HOURS);
        throw new Error('rollback');
      })
      .catch((e: Error) => expect(e.message).toBe('rollback'));
  });
});

describe('P7 change your own password', () => {
  it('refuses a wrong current password with 400 (not 401 — that would trigger a silent refresh)', async () => {
    const u = await makeUser('wrongpw', 'housekeeping');
    const token = await login(u.email);
    const res = await changePw(token, { current_password: 'Nope@1234', new_password: 'Another@2026' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/current password is incorrect/i);
  });

  it('refuses a weak password, or the same one again', async () => {
    const u = await makeUser('weak', 'housekeeping');
    const token = await login(u.email);
    expect((await changePw(token, { current_password: PASSWORD, new_password: 'short' })).status).toBe(400);
    expect((await changePw(token, { current_password: PASSWORD, new_password: PASSWORD })).status).toBe(400);
    // bcrypt ignores everything past 72 bytes — refuse rather than silently truncate.
    expect((await changePw(token, { current_password: PASSWORD, new_password: `Aa1!${'x'.repeat(70)}` })).status).toBe(400);
  });

  it('changes it, keeps this device signed in, and signs out every other device', async () => {
    const u = await makeUser('change', 'housekeeping');
    const here = await login(u.email);
    const elsewhere = await login(u.email);
    const NEW = 'Brand@New2026';

    expect((await changePw(here, { current_password: PASSWORD, new_password: NEW })).status).toBe(204);

    expect((await me(here)).status).toBe(200);
    const other = await me(elsewhere);
    expect(other.status).toBe(401);
    expect(other.body.message).toMatch(/session has ended/i);

    expect((await request(app).post('/api/v1/auth/login').send({ email: u.email, password: PASSWORD })).status).toBe(401);
    await login(u.email, NEW);

    const audit = await db.selectFrom('audit_logs').select('action').where('user_id', '=', u.id).where('entity', '=', 'users').execute();
    expect(audit.length).toBeGreaterThan(0);
  });
});
