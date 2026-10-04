/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test, incl. 082).
 *
 * (Round 4, N-9) Leads and quotes were house-wide: a CBD-only user could list, read, edit
 * and delete every Village enquiry, and read every quote.
 *
 * Rules under test —
 *  Leads: visible when the lead's property is one of mine, or it has no property and I
 *         created it (everyone who can see every property sees all). New leads default to
 *         the property I am working in. I cannot attach a lead to a property I'm not in.
 *  Quotes: visible when I created it, or a hold made from it sits in one of my properties.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { sql } from 'kysely';
import { createLeadsRouter } from '../../../src/modules/crm/leads/leads.routes.js';
import { createQuotesRouter } from '../../../src/modules/quotes/quotes.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';
import { db } from '../../../src/config/db.js';

const mockState = vi.hoisted(() => ({ user: null as any }));
vi.mock('jsonwebtoken', () => ({
  default: {
    verify: () => {
      if (!mockState.user) throw new Error('jwt malformed');
      return mockState.user;
    },
  },
}));

const app = express();
app.use(express.json());
app.use('/leads', createLeadsRouter());
app.use('/quotes', createQuotesRouter());
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PERMS = ['crm.leads.read', 'crm.leads.create', 'crm.leads.update', 'crm.leads.delete', 'quotes.read', 'quotes.create'];
let cbdUser: string, villageUser: string, planId: string;
let propCbd: string, propVillage: string;
let roomCbd: string, roomVillage: string;
const lead: Record<string, string> = {};
const quote: Record<string, string> = {};
const users: string[] = [];

const asCbd = () => { mockState.user = { sub: cbdUser, role: 'reception', permissions: PERMS }; };
const asAdmin = () => { mockState.user = { sub: cbdUser, role: 'admin', permissions: PERMS }; };
const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object, header?: string) => {
  const r = request(app)[method](path).set('Authorization', 'Bearer t');
  if (header) r.set('X-Property-Id', header);
  return r.send(body);
};
const leadIds = async (q = '') =>
  ((await call('get', `/leads?limit=100&search=${uniq}${q}`)).body.data as Array<{ id: string }>).map((l) => l.id);
const quoteIds = async () =>
  ((await call('get', '/quotes?limit=100')).body.data as Array<{ id: string }>).map((q) => q.id);

async function makeLead(tag: string, createdBy: string, property_id: string | null) {
  lead[tag] = (await db.insertInto('leads').values({
    title: `${tag} ${uniq}`, status: 'NEW', property_id, created_by: createdBy, updated_by: createdBy,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
}
async function makeQuote(tag: string, createdBy: string, holdRoom?: string) {
  quote[tag] = (await db.insertInto('quotes').values({
    rate_plan_id: planId, unit_type: 'CUSTOM', check_in_date: new Date('2033-09-01'), check_out_date: new Date('2033-09-02'),
    nights: 1, base_amount: 1000, tax_rate_bps: 0, tax_amount: 0, deposit_amount: 500, total_amount: 1000,
    expires_at: sql`now() + interval '1 day'`, created_by: createdBy,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  if (holdRoom) {
    await db.insertInto('holds').values({
      quote_id: quote[tag], room_id: holdRoom, status: 'HELD', held_until: sql`now() + interval '1 day'`,
      created_by: createdBy, updated_by: createdBy,
    } as never).execute();
  }
}

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'reception').executeTakeFirstOrThrow()).id;
  const mk = async (t: string) => {
    const id = (await db.insertInto('users').values({ role_id: role, name: `LQ ${t}`, email: `lq-${t}-${uniq}@t.local`, password_hash: 'x' })
      .returning('id').executeTakeFirstOrThrow()).id;
    users.push(id);
    return id;
  };
  cbdUser = await mk('cbd');
  villageUser = await mk('village');
  const prop = async (t: string) => {
    const p = (await db.insertInto('properties').values({ name: `LQ_${t}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    const b = (await db.insertInto('buildings').values({ property_id: p, name: `LQB_${t}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    const r = (await db.insertInto('rooms').values({ name: `LQ ${t}`, code: `LQ-${t}-${uniq}`, building_id: b, created_by: cbdUser, updated_by: cbdUser })
      .returning('id').executeTakeFirstOrThrow()).id;
    return { p, r };
  };
  ({ p: propCbd, r: roomCbd } = await prop('CBD'));
  ({ p: propVillage, r: roomVillage } = await prop('VIL'));
  await db.insertInto('user_properties').values([
    { user_id: cbdUser, property_id: propCbd },
    { user_id: villageUser, property_id: propVillage },
  ]).execute();
  planId = (await db.insertInto('rate_plans').values({
    unit_type: 'CUSTOM', name: `LQ plan ${uniq}`, nightly_rate: 1000, weekly_rate: 6000, monthly_rate: 24000, active: false,
    created_by: cbdUser, updated_by: cbdUser,
  } as never).returning('id').executeTakeFirstOrThrow()).id;

  await makeLead('cbdLead', villageUser, propCbd);             // a colleague's CBD lead
  await makeLead('villageLead', villageUser, propVillage);
  await makeLead('villageUnassigned', villageUser, null);       // someone else's unassigned lead
  await makeLead('ownUnassigned', cbdUser, null);

  await makeQuote('ownQuote', cbdUser);                         // mine, no hold
  await makeQuote('cbdHeld', villageUser, roomCbd);             // not mine, but held in CBD
  await makeQuote('villageHeld', villageUser, roomVillage);
  await makeQuote('villageLoose', villageUser);                 // someone else's, no hold
});

afterAll(async () => {
  const q = Object.values(quote);
  await db.deleteFrom('holds').where('quote_id', 'in', q).execute();
  await db.deleteFrom('quotes').where('id', 'in', q).execute();
  await db.deleteFrom('rate_plans').where('id', '=', planId).execute();
  await db.deleteFrom('audit_logs').where('user_id', 'in', users).execute();
  await db.deleteFrom('leads').where('created_by', 'in', users).execute();
  await db.deleteFrom('rooms').where('id', 'in', [roomCbd, roomVillage]).execute();
  await db.deleteFrom('buildings').where('property_id', 'in', [propCbd, propVillage]).execute();
  await db.deleteFrom('user_properties').where('user_id', 'in', users).execute();
  await db.deleteFrom('properties').where('id', 'in', [propCbd, propVillage]).execute();
  await db.deleteFrom('users').where('id', 'in', users).execute();
});

describe('leads', () => {
  it('a CBD-only user lists CBD leads and their own unassigned ones — not Village’s or others’ unassigned', async () => {
    asCbd();
    const ids = await leadIds();
    expect(ids).toContain(lead.cbdLead);
    expect(ids).toContain(lead.ownUnassigned);
    expect(ids).not.toContain(lead.villageLead);
    expect(ids).not.toContain(lead.villageUnassigned);
  });

  it('reads a Village lead by id as "not found"', async () => {
    asCbd();
    expect((await call('get', `/leads/${lead.villageLead}`)).status).toBe(404);
    expect((await call('get', `/leads/${lead.villageUnassigned}`)).status).toBe(404);
    expect((await call('get', `/leads/${lead.cbdLead}`)).status).toBe(200);
  });

  it('cannot edit or delete a Village lead — and it is untouched', async () => {
    asCbd();
    expect((await call('patch', `/leads/${lead.villageLead}`, { title: 'hijacked' })).status).toBe(404);
    expect((await call('delete', `/leads/${lead.villageLead}`)).status).toBe(404);
    const row = await db.selectFrom('leads').select(['title', 'deleted_at']).where('id', '=', lead.villageLead).executeTakeFirstOrThrow();
    expect(row).toEqual({ title: `villageLead ${uniq}`, deleted_at: null });
  });

  it('cannot move a lead into a property they are not in, or hide a colleague’s lead by clearing its property', async () => {
    asCbd();
    expect((await call('patch', `/leads/${lead.cbdLead}`, { property_id: propVillage })).status).toBe(403);
    expect((await call('patch', `/leads/${lead.cbdLead}`, { property_id: null })).status).toBe(403);
  });

  it('a new lead takes the property the user is working in, and cannot be filed under another', async () => {
    asCbd();
    const made = await call('post', '/leads', { title: `new ${uniq}` }, propCbd);
    expect(made.status).toBe(201);
    expect(made.body.property_id).toBe(propCbd);
    expect((await call('post', '/leads', { title: `bad ${uniq}`, property_id: propVillage })).status).toBe(403);
  });

  it('an all-property user (admin) sees every lead, including unassigned ones', async () => {
    asAdmin();
    const ids = await leadIds();
    expect(ids).toEqual(expect.arrayContaining([lead.cbdLead, lead.villageLead, lead.villageUnassigned, lead.ownUnassigned]));
    expect((await call('get', `/leads/${lead.villageUnassigned}`)).status).toBe(200);
  });
});

describe('quotes', () => {
  it('a CBD-only user sees their own quotes and quotes held in CBD — nothing else', async () => {
    asCbd();
    const ids = await quoteIds();
    expect(ids).toContain(quote.ownQuote);
    expect(ids).toContain(quote.cbdHeld);
    expect(ids).not.toContain(quote.villageHeld);
    expect(ids).not.toContain(quote.villageLoose);
  });

  it('reads another property’s quote by id as "not found"', async () => {
    asCbd();
    expect((await call('get', `/quotes/${quote.villageHeld}`)).status).toBe(404);
    expect((await call('get', `/quotes/${quote.villageLoose}`)).status).toBe(404);
    expect((await call('get', `/quotes/${quote.cbdHeld}`)).status).toBe(200);
  });

  it('an all-property user (admin) sees every quote', async () => {
    asAdmin();
    for (const id of Object.values(quote)) expect((await call('get', `/quotes/${id}`)).status).toBe(200);
  });
});
