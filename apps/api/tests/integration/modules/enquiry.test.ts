/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves public enquiry capture: a NEW lead is filed from a website/WhatsApp
 * enquiry, a CRM contact is found-or-created when an email is given (no duplicate
 * on a repeat enquiry), and an enquiry without an email files a lead only. Fixtures
 * are self-created and located by a unique tag embedded in the message.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { PublicService } from '../../../src/modules/public/public.service.js';
import { PublicRepository } from '../../../src/modules/public/public.repository.js';
import { ReservationsService } from '../../../src/modules/reservations/reservations.service.js';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository.js';
import { RoomsRepository } from '../../../src/modules/rooms/rooms.repository.js';
import { PricingService } from '../../../src/modules/pricing/pricing.service.js';
import { PricingRepository } from '../../../src/modules/pricing/pricing.repository.js';
import { ContactsRepository } from '../../../src/modules/crm/contacts/contacts.repository.js';
import { LeadsRepository } from '../../../src/modules/crm/leads/leads.repository.js';

const service = new PublicService(
  new PublicRepository(db),
  new ReservationsService(new ReservationsRepository(db), new RoomsRepository(db), new PricingService(new PricingRepository(db))),
  new ContactsRepository(db),
  new LeadsRepository(db),
);

const tag = `ENQTEST-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const email = `a-${tag}@t.example`.toLowerCase();

const leadsByTag = () => db.selectFrom('leads').selectAll().where('description', 'ilike', `%${tag}%`).execute();
const contactsByEmail = () => db.selectFrom('contacts').selectAll().where('email', '=', email).where('deleted_at', 'is', null).execute();

afterAll(async () => {
  const leads = await leadsByTag();
  if (leads.length) await db.deleteFrom('leads').where('id', 'in', leads.map((l) => l.id)).execute();
  const contacts = await contactsByEmail();
  if (contacts.length) await db.deleteFrom('contacts').where('id', 'in', contacts.map((c) => c.id)).execute();
});

describe('Public enquiry capture (live DB)', () => {
  it('files a NEW lead and creates a linked contact when an email is given', async () => {
    const res = await service.createEnquiry(
      { name: 'Alpha', email, phone: '+267 71 000 111', message: `Need a suite ${tag}`, source: 'WEBSITE' },
      { ip: '203.0.113.7' },
    );
    expect(res.reference).toMatch(/^ENQ-[0-9A-F]{6}$/);

    const [lead] = (await leadsByTag()).filter((l) => l.title.startsWith('Need a suite'));
    expect(lead.status).toBe('NEW');
    expect(lead.source).toBe('WEBSITE');
    expect(lead.phone).toBe('+267 71 000 111');
    expect(lead.contact_id).not.toBeNull();

    const contacts = await contactsByEmail();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.name).toBe('Alpha');
    expect(lead.contact_id).toBe(contacts[0]!.id);
  });

  it('reuses the existing contact on a repeat enquiry from the same email', async () => {
    const before = (await contactsByEmail())[0]!.id;
    await service.createEnquiry(
      { name: 'Alpha', email, message: `Follow-up ${tag}`, source: 'WHATSAPP' },
      { ip: '203.0.113.7' },
    );
    const contacts = await contactsByEmail();
    expect(contacts).toHaveLength(1); // no duplicate

    const [lead] = (await leadsByTag()).filter((l) => l.title.startsWith('Follow-up'));
    expect(lead.contact_id).toBe(before);
    expect(lead.source).toBe('WHATSAPP');
  });

  // (Small improvements, from R7) An enquiry typed with someone else's email was filed under
  // THAT guest — staff then saw the enquiry on the wrong person. Like a website booking (R6),
  // it now stays with the existing guest only when it is plainly the same person: same email
  // and the same phone, or the same name when no phone was given. Otherwise a new record,
  // noted as a possible duplicate.
  it('files an enquiry from a different person with the same email under a new, flagged guest', async () => {
    const owner = (await contactsByEmail())[0]!.id;
    await service.createEnquiry(
      { name: 'Somebody Else', email, phone: '+267 75 999 999', message: `Other person ${tag}`, source: 'WEBSITE' },
      { ip: '203.0.113.7' },
    );
    const [lead] = (await leadsByTag()).filter((l) => l.title.startsWith('Other person'));
    expect(lead.contact_id).not.toBe(owner);
    const created = await db.selectFrom('contacts').selectAll().where('id', '=', lead.contact_id!).executeTakeFirstOrThrow();
    expect(created.name).toBe('Somebody Else');
    expect(created.email_shared).toBe(true);
    expect(created.notes).toMatch(/possible duplicate/i);
  });

  it('keeps an enquiry with the same email and the same number (written another way) with that guest', async () => {
    const owner = (await contactsByEmail()).find((c) => c.name === 'Alpha')!.id;
    await service.createEnquiry(
      { name: 'A. Lpha', email, phone: '71 000 111', message: `Same number ${tag}`, source: 'WEBSITE' },
      { ip: '203.0.113.7' },
    );
    const [lead] = (await leadsByTag()).filter((l) => l.title.startsWith('Same number'));
    expect(lead.contact_id).toBe(owner);
  });

  it('files a lead only (no contact) when there is no email', async () => {
    await service.createEnquiry(
      { name: 'Charlie', phone: '+267 72 000 222', message: `Walk-in ask ${tag}`, source: 'WEBSITE' },
      { ip: '203.0.113.7' },
    );
    const [lead] = (await leadsByTag()).filter((l) => l.title.startsWith('Walk-in ask'));
    expect(lead.contact_id).toBeNull();
    expect(lead.phone).toBe('+267 72 000 222');
  });

  // (R5) The form asks which property, so a limited manager sees their own enquiries.
  it('files the lead under the property the guest chose', async () => {
    const { properties } = await service.getEnquiryProperties();
    expect(properties.length).toBeGreaterThan(0);
    const chosen = properties[0]!;
    await service.createEnquiry(
      { name: 'Delta', message: `Chosen property ${tag}`, source: 'WEBSITE', property_id: chosen.id },
      { ip: '203.0.113.7' },
    );
    const [lead] = (await leadsByTag()).filter((l) => l.title.startsWith('Chosen property'));
    expect(lead.property_id).toBe(chosen.id);
  });

  it('refuses a property that is not one of ours', async () => {
    await expect(
      service.createEnquiry(
        { name: 'Echo', message: `Bogus property ${tag}`, source: 'WEBSITE', property_id: '00000000-0000-0000-0000-000000000000' },
        { ip: '203.0.113.7' },
      ),
    ).rejects.toThrow(/choose one of our properties/);
  });
});
