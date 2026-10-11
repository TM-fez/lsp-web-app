/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Audit 2026-10-11, L-10) Linking an id is a way of SEEING the thing linked: a file takes its
 * library category and property from the record pointing at it, and a quote held in your
 * property becomes yours. Writers only checked the id existed. Now a file must be your own
 * upload (or you see every property), and a quote one you can see.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { ContactsService } from '../../../src/modules/crm/contacts/contacts.service.js';
import { ContactsRepository } from '../../../src/modules/crm/contacts/contacts.repository.js';
import { HoldsService } from '../../../src/modules/holds/holds.service.js';
import { HoldsRepository } from '../../../src/modules/holds/holds.repository.js';
import { QuotesService } from '../../../src/modules/quotes/quotes.service.js';
import { QuotesRepository } from '../../../src/modules/quotes/quotes.repository.js';
import { PricingService } from '../../../src/modules/pricing/pricing.service.js';
import { PricingRepository } from '../../../src/modules/pricing/pricing.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let limited: string, other: string, admin: string, propA: string, planId: string;
let othersFile: string, myFile: string, othersQuote: string;
const contactIds: string[] = [];

const contacts = new ContactsService(new ContactsRepository(db));
const holds = new HoldsService(new HoldsRepository(db), new QuotesService(new QuotesRepository(db), new PricingService(new PricingRepository(db))));

async function file(tag: string, by: string) {
  return (await db.insertInto('files').values({
    original_name: `${tag}-${uniq}.png`, stored_name: `${tag}-${uniq}.png`, mime_type: 'image/png', extension: 'png',
    size_bytes: 10, checksum: `${tag}-${uniq}`, storage_driver: 'local', bucket: null, path: `/x/${tag}-${uniq}`, created_by: by,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
}

beforeAll(async () => {
  const user = async (role: string, tag: string) => {
    const roleId = (await db.selectFrom('roles').select('id').where('name', '=', role).executeTakeFirstOrThrow()).id;
    return (await db.insertInto('users').values({ role_id: roleId, name: `L10 ${tag}`, email: `l10-${tag}-${uniq}@t.local`, password_hash: 'x' })
      .returning('id').executeTakeFirstOrThrow()).id;
  };
  limited = await user('reception', 'limited');
  other = await user('reception', 'other');
  admin = await user('admin', 'admin');
  propA = (await db.insertInto('properties').values({ name: `L10_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  await db.insertInto('user_properties').values({ user_id: limited, property_id: propA }).execute();
  othersFile = await file('others', other);
  myFile = await file('mine', limited);
  planId = (await db.insertInto('rate_plans').values({
    unit_type: 'CONFERENCE', name: `L10 plan ${uniq}`, nightly_rate: 100_000, weekly_rate: 600_000, monthly_rate: 2_400_000,
    max_guests: 2, deposit_pct: 50, tax_rate_bps: 0, active: false, created_by: other, updated_by: other,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  othersQuote = (await db.insertInto('quotes').values({
    rate_plan_id: planId, unit_type: 'CONFERENCE', check_in_date: new Date('2040-01-01'), check_out_date: new Date('2040-01-03'),
    guests: 1, nights: 2, base_amount: 200_000, tax_rate_bps: 0, tax_amount: 0, deposit_amount: 100_000, total_amount: 200_000,
    created_by: other, expires_at: new Date(Date.now() + 3_600_000),
  } as never).returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  const users = [limited, other, admin];
  await db.deleteFrom('contacts').where('id', 'in', contactIds.length ? contactIds : ['00000000-0000-4000-a000-000000000000']).execute();
  await db.deleteFrom('audit_logs').where('user_id', 'in', users).execute();
  await db.deleteFrom('quotes').where('id', '=', othersQuote).execute();
  await db.deleteFrom('rate_plans').where('id', '=', planId).execute();
  await db.deleteFrom('files').where('id', 'in', [othersFile, myFile]).execute();
  await db.deleteFrom('user_properties').where('user_id', 'in', users).execute();
  await db.deleteFrom('properties').where('id', '=', propA).execute();
  await db.deleteFrom('users').where('id', 'in', users).execute();
});

describe('Audit L-10 — files', () => {
  it('a limited user cannot make someone else’s file a guest’s picture', async () => {
    await expect(
      contacts.createContact({ name: `L10 guest ${uniq}`, avatar_file_id: othersFile } as never, { userId: limited } as never),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('their own upload is fine, and an all-property user may link any file', async () => {
    const mine = await contacts.createContact({ name: `L10 own ${uniq}`, avatar_file_id: myFile } as never, { userId: limited } as never);
    contactIds.push(mine.id);
    const byAdmin = await contacts.createContact({ name: `L10 admin ${uniq}`, avatar_file_id: othersFile } as never, { userId: admin } as never);
    contactIds.push(byAdmin.id);
  });
});

describe('Audit L-10 — quotes', () => {
  it('a hold cannot use a quote the caller cannot see', async () => {
    await expect(
      holds.createHold({ quote_id: othersQuote } as never, { userId: limited }, { userId: limited, ids: [propA], allProperties: false }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
