/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (R5 retest) A second guest with an email another guest already uses is a question, not a
 * silent save: 409 "Duplicate Email" (never naming the other guest), unless the caller says
 * "save anyway". Editing a guest's own email back to itself is not a duplicate.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { ContactsService } from '../../../src/modules/crm/contacts/contacts.service.js';
import { ContactsRepository } from '../../../src/modules/crm/contacts/contacts.repository.js';

const service = new ContactsService(new ContactsRepository(db));
const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `dup-${uniq}@t.example`;
let userId: string;
const meta = () => ({ userId });

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users').values({ role_id: role.id, name: 'DUP', email: `dupu-${uniq}@t.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('contacts').where('created_by', '=', userId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('duplicate guest email', () => {
  it('asks before saving a second guest with the same email, whatever its case', async () => {
    const first = await service.createContact({ type: 'individual', name: 'Neo One', email }, meta());
    const err = await service.createContact({ type: 'individual', name: 'Neo Two', email: email.toUpperCase() }, meta()).catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(err.error).toBe('Duplicate Email');
    expect(err.message).not.toContain('Neo One');

    const second = await service.createContact({ type: 'individual', name: 'Neo Two', email, allow_duplicate_email: true }, meta());
    expect(second.email).toBe(email);
    expect('allow_duplicate_email' in second).toBe(false);

    // Saving a guest with their own unchanged email is not a duplicate of themselves.
    const edited = await service.updateContact(first.id, { name: 'Neo One B', email, allow_duplicate_email: true }, meta());
    expect(edited.name).toBe('Neo One B');
  });

  it('asks on an edit that takes another guest’s email', async () => {
    const other = `other-${uniq}@t.example`;
    await service.createContact({ type: 'individual', name: 'Kago', email: other }, meta());
    const mine = await service.createContact({ type: 'individual', name: 'Mpho', email: `mine-${uniq}@t.example` }, meta());
    const err = await service.updateContact(mine.id, { email: other }, meta()).catch((e) => e);
    expect(err.error).toBe('Duplicate Email');
  });

  // (R6 NEW-3) A full-form edit resends every field. A guest who already SHARES an email
  // (saved with "Save anyway") got 409 on every edit, even with the email untouched.
  it('does not ask again when an edit resends a shared email unchanged', async () => {
    const shared = `shared-${uniq}@t.example`;
    await service.createContact({ type: 'individual', name: 'Parent', email: shared }, meta());
    const child = await service.createContact({ type: 'individual', name: 'Child', email: shared, allow_duplicate_email: true }, meta());
    const edited = await service.updateContact(child.id, { name: 'Child B', email: shared.toUpperCase(), phone: '+267 70 000 000' }, meta());
    expect(edited.name).toBe('Child B');
  });
});

// (R6 NEW-4) The check ran before the insert: 6 parallel saves of one new email made 2 guests.
describe('duplicate guest email — parallel saves', () => {
  it('six parallel saves of one new email make exactly one guest; the rest get the question', async () => {
    const racer = `race-${uniq}@t.example`;
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => service.createContact({ type: 'individual', name: `Racer ${i}`, email: racer }, meta())),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason.error).toBe('Duplicate Email');
    }
    const rows = await db.selectFrom('contacts').select('id').where('email', '=', racer).where('deleted_at', 'is', null).execute();
    expect(rows).toHaveLength(1);
  });

  // (R6 NEW-2) The override is recorded — on the row, and so in its audit entry.
  it('records "Save anyway" on the guest and in the audit trail', async () => {
    const sharedEmail = `audited-${uniq}@t.example`;
    await service.createContact({ type: 'individual', name: 'First', email: sharedEmail }, meta());
    const second = await service.createContact({ type: 'individual', name: 'Second', email: sharedEmail, allow_duplicate_email: true }, meta());
    expect(second.email_shared).toBe(true);
    const audit = await db.selectFrom('audit_logs').select('diff').where('entity', '=', 'contacts').where('entity_id', '=', second.id).executeTakeFirstOrThrow();
    expect((audit.diff as Record<string, unknown>).email_shared).toBe(true);
  });
});
