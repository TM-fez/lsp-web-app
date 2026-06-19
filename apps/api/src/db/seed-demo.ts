/**
 * DEMO seed — fills a LOCAL dev database with realistic, fully-tagged sample data
 * so the Accounts / Reports dashboards have something to show.
 *
 * Safety:
 *   • Refuses to run unless DATABASE_URL points at localhost (override with
 *     ALLOW_NONLOCAL_SEED=1 only if you really know what you're doing).
 *   • Never run against production. The live site has REAL apartments + guests.
 *
 * Every row it creates is tagged so teardown is a single deterministic pass:
 *   • contacts   → email ends "@demo.local"
 *   • buildings  → name ends " [DEMO]"
 *   • rooms      → code starts "DEMO-"
 *   • rate_plans → name starts "DEMO "
 *   • reservations → notes start "DEMO"
 *   • quotes     → breakdown->>'demo' = 'true'
 *   • invoices   → number starts "INV-DEMO-"
 *   • work orders→ title starts "DEMO"
 *
 * Usage:
 *   npm run db:seed:demo          # wipe demo rows, then regenerate (idempotent)
 *   npm run db:seed:demo:reset    # wipe demo rows only, generate nothing
 */
import 'dotenv/config';
import pkg from 'pg';

const { Client } = pkg;

const CONNECTION =
  process.env['DATABASE_URL'] ?? 'postgresql://lsp:lsp@localhost:5432/lsp_dev';

// ── Safety guard ────────────────────────────────────────────────────────────
function hostIsLocal(conn: string): boolean {
  let host = '';
  try {
    host = new URL(conn).hostname;
  } catch {
    return false;
  }
  return ['localhost', '127.0.0.1', '::1', ''].includes(host);
}

function assertLocal(conn: string): void {
  if (process.env['ALLOW_NONLOCAL_SEED'] === '1') return;
  let host = '';
  try {
    host = new URL(conn).hostname;
  } catch {
    /* fall through to refusal */
  }
  const local = ['localhost', '127.0.0.1', '::1', ''];
  if (!local.includes(host)) {
    console.error(
      `\n✗ Refusing to seed demo data: DATABASE_URL host is "${host}", not localhost.\n` +
        `  This script is for LOCAL dev only. The live database has real data.\n` +
        `  (Set ALLOW_NONLOCAL_SEED=1 to override — almost never what you want.)\n`
    );
    process.exit(1);
  }
}

// ── Tiny seeded RNG (mulberry32) so runs are reproducible ─────────────────────
let _s = 0x9e3779b9;
function rnd(): number {
  _s |= 0;
  _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]!;
const chance = (p: number) => rnd() < p;

// ── Date helpers (plain YYYY-MM-DD; demo data, property-day precision is fine) ─
const DAY = 86_400_000;
// The real current UTC day, so "in-house today" reflects whenever the seed runs.
const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const iso = (d: Date) => d.toISOString().slice(0, 10);

// ── Money (thebe; 100 = 1 BWP). Inclusive tax split mirrors quotes.util ───────
function splitInclusive(total: number, bps: number) {
  const subtotal = Math.round(total / (1 + bps / 10000));
  return { subtotal, tax: total - subtotal };
}

const FIRST = [
  'Thato', 'Lesedi', 'Tumelo', 'Boitumelo', 'Mpho', 'Naledi', 'Kabo', 'Tshepo',
  'Kefilwe', 'Bonolo', 'Gaone', 'Oratile', 'Lorato', 'Neo', 'Karabo', 'Warona',
  'Goitseone', 'Atang', 'Kgosi', 'Onkgopotse', 'Amantle', 'Reneilwe', 'Pako', 'Yarona',
];
const LAST = [
  'Moeng', 'Tau', 'Phiri', 'Molefe', 'Seretse', 'Dube', 'Modise', 'Mogapi',
  'Sebina', 'Pule', 'Khama', 'Motswasele', 'Bakwena', 'Ramotswe', 'Kgomotso', 'Selepeng',
];
const BLOCKS = ['B', 'D', 'G', 'I', 'J', 'T'];
const UNIT_TYPES = ['STANDARD', 'DELUXE', 'SUITE'] as const;
type UnitType = (typeof UNIT_TYPES)[number];

// nightly / weekly / monthly in thebe, per unit type
const RATES: Record<UnitType, { nightly: number; weekly: number; monthly: number; guests: number }> = {
  STANDARD: { nightly: 65_000, weekly: 390_000, monthly: 1_400_000, guests: 2 },
  DELUXE: { nightly: 95_000, weekly: 570_000, monthly: 2_100_000, guests: 3 },
  SUITE: { nightly: 150_000, weekly: 900_000, monthly: 3_400_000, guests: 4 },
};
const TAX_BPS = 1400; // 14% VAT (Botswana)
const DEPOSIT_PCT = 50;

const client = new Client({
  connectionString: CONNECTION,
  // Remote hosts (Render/Supabase) require SSL; local Postgres doesn't.
  ssl: hostIsLocal(CONNECTION) ? false : { rejectUnauthorized: false },
});

// Aim the whole house (real units + demo units) at roughly this occupancy *today*.
const TARGET_OCCUPANCY = 0.30;

async function teardown(): Promise<void> {
  // FK-safe order: children first.
  const steps: Array<[string, string]> = [
    // occupancy rows the live app may have created for demo bookings (FK → reservations/rooms);
    // must go before reservations + rooms. Only deletes rows tied to demo data.
    ['occupancy', `DELETE FROM occupancy WHERE reservation_id IN (SELECT id FROM reservations WHERE notes LIKE 'DEMO%') OR room_id IN (SELECT id FROM rooms WHERE code LIKE 'DEMO-%')`],
    ['operating_expenses', `DELETE FROM operating_expenses WHERE notes = 'DEMO'`],
    ['invoices', `DELETE FROM invoices WHERE number LIKE 'INV-DEMO-%'`],
    ['quotes', `DELETE FROM quotes WHERE breakdown->>'demo' = 'true'`],
    ['reservations', `DELETE FROM reservations WHERE notes LIKE 'DEMO%'`],
    ['maintenance_work_orders', `DELETE FROM maintenance_work_orders WHERE title LIKE 'DEMO%'`],
    ['rooms', `DELETE FROM rooms WHERE code LIKE 'DEMO-%'`],
    ['buildings', `DELETE FROM buildings WHERE name LIKE '% [DEMO]'`],
    ['rate_plans', `DELETE FROM rate_plans WHERE name LIKE 'DEMO %'`],
    ['contacts', `DELETE FROM contacts WHERE email LIKE '%@demo.local'`],
  ];
  for (const [label, sql] of steps) {
    const res = await client.query(sql);
    if (res.rowCount) console.log(`  − removed ${res.rowCount} ${label}`);
  }
}

async function run(): Promise<void> {
  assertLocal(CONNECTION);
  await client.connect();

  const resetOnly = process.argv.includes('--reset');

  // Admin user is the actor on every audited row.
  const { rows: [admin] } = await client.query(
    `SELECT id FROM users WHERE email = 'admin@lsp.local' LIMIT 1`
  );
  if (!admin) {
    console.error('No admin user found. Run `npm run db:seed` first.');
    process.exit(1);
  }
  const A: string = admin.id;

  // Village property (seeded by migration 040).
  const { rows: [village] } = await client.query(
    `SELECT id FROM properties WHERE code = 'VLG' LIMIT 1`
  );
  if (!village) {
    console.error('Village property not found. Run `npm run db:migrate` first.');
    process.exit(1);
  }

  console.log('Clearing any existing demo data…');
  await client.query('BEGIN');
  await teardown();

  if (resetOnly) {
    await client.query('COMMIT');
    console.log('✓ Demo data cleared (reset only).');
    await client.end();
    process.exit(0);
  }

  console.log('Generating demo data…');

  // 1. Buildings (blocks) under Village.
  const buildingIds: string[] = [];
  for (const b of BLOCKS) {
    const { rows: [row] } = await client.query(
      `INSERT INTO buildings (property_id, name, code, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $4) RETURNING id`,
      [village.id, `Block ${b} [DEMO]`, `DEMO-${b}`, A]
    );
    buildingIds.push(row.id);
  }

  // 2. Rate plans, one per unit type.
  const ratePlanByType: Record<UnitType, string> = {} as Record<UnitType, string>;
  for (const t of UNIT_TYPES) {
    const r = RATES[t];
    // active=false: a UNIQUE index allows only one ACTIVE rate plan per unit_type,
    // and live already has real active ones. Demo quotes reference these by id and
    // carry their own amounts, so inactive is fine.
    const { rows: [row] } = await client.query(
      `INSERT INTO rate_plans
         (unit_type, name, nightly_rate, weekly_rate, monthly_rate, min_nights,
          max_guests, deposit_pct, tax_rate_bps, currency, active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,'BWP',false,$9,$9) RETURNING id`,
      [t, `DEMO ${t[0]}${t.slice(1).toLowerCase()} Rate`, r.nightly, r.weekly,
        r.monthly, r.guests, DEPOSIT_PCT, TAX_BPS, A]
    );
    ratePlanByType[t] = row.id;
  }

  // 3. Rooms (units), spread across blocks.
  const rooms: Array<{ id: string; type: UnitType }> = [];
  let unitNo = 0;
  for (let bi = 0; bi < BLOCKS.length; bi++) {
    for (let u = 1; u <= 4; u++) {
      unitNo++;
      const type = UNIT_TYPES[unitNo % UNIT_TYPES.length]!;
      const code = `DEMO-${BLOCKS[bi]}${u}`;
      const { rows: [row] } = await client.query(
        `INSERT INTO rooms (name, code, type, status, capacity, building_id, notes, created_by, updated_by)
         VALUES ($1,$2,$3,'AVAILABLE',$4,$5,'DEMO unit',$6,$6) RETURNING id`,
        [`${BLOCKS[bi]}${u} [DEMO]`, code, type, RATES[type].guests, buildingIds[bi], A]
      );
      rooms.push({ id: row.id, type });
    }
  }

  // 4. Guests (contacts).
  const guestIds: string[] = [];
  const usedEmails = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    let email = `${name.toLowerCase().replace(/[^a-z]/g, '.')}@demo.local`;
    while (usedEmails.has(email)) email = `${name.toLowerCase().replace(/[^a-z]/g, '.')}.${i}@demo.local`;
    usedEmails.add(email);
    const { rows: [row] } = await client.query(
      `INSERT INTO contacts (type, name, email, phone, notes, created_by, updated_by)
       VALUES ('individual',$1,$2,$3,'DEMO guest',$4,$4) RETURNING id`,
      [name, email, `+267 7${randInt(1000000, 9999999)}`, A]
    );
    guestIds.push(row.id);
  }

  // 5. Reservations + quotes + invoices + (some) maintenance, per room over time.
  let nRes = 0, nInv = 0, nWO = 0, nOpex = 0;
  let revenue = 0, expenses = 0, opexTotal = 0;

  const newInvoice = async (
    quoteId: string, resId: string, kind: 'DEPOSIT' | 'BALANCE' | 'REFUND',
    total: number, status: string, when: Date
  ) => {
    const { subtotal, tax } = splitInclusive(total, TAX_BPS);
    const number = `INV-DEMO-${String(++nInv).padStart(5, '0')}`;
    // created_at is dated to the business event (payment/booking), not insertion
    // time, so the reports time-series reflects real months.
    await client.query(
      `INSERT INTO invoices
         (number, quote_id, reservation_id, kind, currency, subtotal_amount,
          tax_rate_bps, tax_amount, total_amount, status, issued_by, created_by, updated_by,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,'BWP',$5,$6,$7,$8,$9,$10,$10,$10,$11,$11)`,
      [number, quoteId, resId, kind, subtotal, TAX_BPS, tax, total, status, A, when.toISOString()]
    );
    if (status === 'PAID') revenue += kind === 'REFUND' ? -total : total;
  };

  // Insert one stay: reservation + quote + deposit/balance invoices, for a given status.
  const placeStay = async (room: { id: string; type: UnitType }, checkIn: Date, checkOut: Date, status: string) => {
    const r = RATES[room.type];
    const nights = Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / DAY));
    const isPast = status === 'CHECKED_OUT';
    const isCancelled = status === 'CANCELLED';
    const guest = pick(guestIds);
    const guests = randInt(1, r.guests);

    // When the booking was made (deposit paid): a few weeks before check-in, never future.
    let bookedAt = addDays(checkIn, -randInt(3, 30));
    if (bookedAt > today) bookedAt = addDays(today, -randInt(0, 5));

    const base = r.nightly * nights;
    const tax = Math.round(base * TAX_BPS / 10000);
    const total = base + tax;
    const deposit = Math.round(total * DEPOSIT_PCT / 100);

    const { rows: [resRow] } = await client.query(
      `INSERT INTO reservations
         (contact_id, room_id, check_in_date, check_out_date, status, notes,
          created_by, updated_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$8) RETURNING id`,
      [guest, room.id, iso(checkIn), iso(checkOut), status, `DEMO ${room.type} ${nights}n`, A, bookedAt.toISOString()]
    );
    nRes++;

    const { rows: [quoteRow] } = await client.query(
      `INSERT INTO quotes
         (rate_plan_id, unit_type, check_in_date, check_out_date, guests, nights,
          currency, base_amount, adjustment_amount, tax_rate_bps, tax_amount,
          deposit_amount, total_amount, breakdown, status, created_by, expires_at,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'BWP',$7,0,$8,$9,$10,$11,$12,'ACTIVE',$13,$14,$15,$15)
       RETURNING id`,
      [ratePlanByType[room.type], room.type, iso(checkIn), iso(checkOut), guests, nights,
        base, TAX_BPS, tax, deposit, total,
        JSON.stringify({ demo: true, nightly: r.nightly, nights }), A,
        addDays(checkIn, -1).toISOString(), bookedAt.toISOString()]
    );

    const cancelledAt = addDays(checkIn, -randInt(0, 2));
    if (isCancelled) {
      if (chance(0.5)) {
        await newInvoice(quoteRow.id, resRow.id, 'DEPOSIT', deposit, 'REFUNDED', bookedAt);
        await newInvoice(quoteRow.id, resRow.id, 'REFUND', deposit, 'PAID', cancelledAt);
      } else {
        await newInvoice(quoteRow.id, resRow.id, 'DEPOSIT', deposit, 'PAID', bookedAt);
      }
    } else {
      await newInvoice(quoteRow.id, resRow.id, 'DEPOSIT', deposit, 'PAID', bookedAt);
      const balance = total - deposit;
      await newInvoice(quoteRow.id, resRow.id, 'BALANCE', balance, isPast ? 'PAID' : 'ISSUED', isPast ? checkOut : bookedAt);
    }
  };

  // How many demo units should be in-house TODAY to bring the whole house (real +
  // demo units) to ~TARGET_OCCUPANCY. Real units already occupied today count, so
  // we only top up the difference.
  const { rows: [occ] } = await client.query(
    `SELECT
       (SELECT count(*) FROM rooms WHERE deleted_at IS NULL AND code NOT LIKE 'DEMO-%') AS existing_rooms,
       (SELECT count(DISTINCT r.room_id) FROM reservations r
          JOIN rooms rm ON rm.id = r.room_id
          WHERE r.deleted_at IS NULL AND rm.code NOT LIKE 'DEMO-%'
            AND r.status IN ('CONFIRMED','CHECKED_IN')
            AND r.check_in_date <= CURRENT_DATE AND r.check_out_date > CURRENT_DATE) AS existing_inhouse`
  );
  const existingRooms = Number(occ.existing_rooms);
  const existingInhouse = Number(occ.existing_inhouse);
  const totalUnits = existingRooms + rooms.length;
  const demoToOccupy = Math.max(0, Math.min(rooms.length, Math.round(TARGET_OCCUPANCY * totalUnits) - existingInhouse));
  let nInhouse = 0;

  for (let idx = 0; idx < rooms.length; idx++) {
    const room = rooms[idx]!;
    const occupyToday = idx < demoToOccupy;
    // Occupied units get history only up to ~a week ago, then a current CHECKED_IN stay,
    // so there's no overlap with the live booking.
    const roomHorizon = occupyToday ? addDays(today, -8) : addDays(today, 60);

    let cursor = addDays(today, -randInt(200, 215));
    while (cursor < roomHorizon) {
      const nights = randInt(2, 21);
      const checkIn = cursor;
      const checkOut = addDays(checkIn, nights);
      if (checkOut >= roomHorizon) break;
      const isPast = checkOut < today;
      const isCancelled = chance(0.08);
      const status = isCancelled ? 'CANCELLED' : isPast ? 'CHECKED_OUT' : chance(0.8) ? 'CONFIRMED' : 'PENDING';
      await placeStay(room, checkIn, checkOut, status);
      cursor = addDays(checkOut, randInt(1, 18));
    }

    if (occupyToday) {
      await placeStay(room, addDays(today, -randInt(1, 6)), addDays(today, randInt(2, 9)), 'CHECKED_IN');
      nInhouse++;
    }
  }

  // 6. Maintenance work orders with contractor costs (the "expenses" side of P&L).
  for (let i = 0; i < 50; i++) {
    const room = pick(rooms);
    const opened = addDays(today, -randInt(5, 210));
    const done = chance(0.85);
    const completed = done ? addDays(opened, randInt(1, 10)) : null;
    const cost = randInt(2, 60) * 10_000; // P20 – P600 → thebe
    const approved = done && chance(0.9);
    const reconciled = approved && chance(0.8);
    const title = `DEMO ${pick(['Plumbing', 'Electrical', 'Aircon', 'Painting', 'Appliance', 'Locks'])} repair`;
    await client.query(
      `INSERT INTO maintenance_work_orders
         (room_id, title, description, status, priority, reported_by, opened_at,
          started_at, completed_at, contractor_name, cost_amount,
          cost_approved_by, cost_approved_at, cost_reconciled_by, cost_reconciled_at,
          created_at, updated_at)
       VALUES ($1,$2,'DEMO work order',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$6,$6)`,
      [room.id, title, done ? 'COMPLETED' : 'OPEN', pick(['LOW', 'MEDIUM', 'HIGH']),
        A, opened.toISOString(), completed?.toISOString() ?? null, completed?.toISOString() ?? null,
        `DEMO ${pick(['Kgosi', 'Tau', 'Phiri'])} Contractors`, cost,
        approved ? A : null, approved ? (completed ?? opened).toISOString() : null,
        reconciled ? A : null, reconciled ? (completed ?? opened).toISOString() : null]
    );
    nWO++;
    if (approved) expenses += cost;
  }

  // 7. Operating expenses — recurring overhead (rent, payroll, utilities, marketing…)
  //    so the P&L shows a realistic margin instead of "revenue minus a few repairs".
  //    Property-level costs attach to Village; company-wide costs leave property NULL.
  const monthStart = (back: number) =>
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
  const dISO = (d: Date) => d.toISOString().slice(0, 10);
  type OpexRow = [string, string | null, string, string, number, string];
  const opexRows: OpexRow[] = [];

  for (let back = 8; back >= 0; back--) {
    const m = monthStart(back);
    const y = m.getUTCFullYear(), mo = m.getUTCMonth();
    const day = (n: number) => dISO(new Date(Date.UTC(y, mo, n)));
    opexRows.push(['RENT',      village.id, 'Monthly rent — Village',        'DEMO Plot 54 Holdings',      3_800_000, day(1)]);
    opexRows.push(['INSURANCE', null,       'Property & liability insurance', 'DEMO Botswana Insurance',     450_000, day(1)]);
    opexRows.push(['MARKETING', null,       'Digital ads (Meta + Google)',    'DEMO Adwords',     (80 + randInt(0, 70)) * 1000, day(5)]);
    opexRows.push(['UTILITIES', village.id, 'Electricity & water — Village',  'DEMO BPC / WUC',  (600 + randInt(0, 320)) * 1000, day(10)]);
    opexRows.push(['SOFTWARE',  null,       'SaaS subscriptions',             'DEMO Stack',                  95_000, day(12)]);
    opexRows.push(['PAYROLL',   null,       'Staff salaries',                 'DEMO Payroll', 5_500_000 + randInt(0, 1_000) * 1000, day(25)]);
    for (let s = 0, n = randInt(2, 4); s < n; s++) {
      opexRows.push(['SUPPLIES', village.id, 'Cleaning & guest supplies', 'DEMO Cash & Carry', (80 + randInt(0, 170)) * 1000, day(randInt(2, 27))]);
    }
  }

  for (const [category, pid, description, vendor, amount, on] of opexRows) {
    await client.query(
      `INSERT INTO operating_expenses
         (property_id, category, description, vendor, amount, incurred_on, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'DEMO',$7,$7)`,
      [pid, category, description, vendor, amount, on, A]
    );
    nOpex++;
    opexTotal += amount;
  }

  await client.query('COMMIT');

  const P = (thebe: number) => `P${(thebe / 100).toLocaleString('en', { minimumFractionDigits: 2 })}`;
  console.log('\n✓ Demo seed complete');
  console.log(`  buildings:     ${BLOCKS.length}`);
  console.log(`  rate plans:    ${UNIT_TYPES.length}`);
  console.log(`  rooms:         ${rooms.length}`);
  console.log(`  guests:        ${guestIds.length}`);
  console.log(`  reservations:  ${nRes}`);
  console.log(`  invoices:      ${nInv}`);
  console.log(`  work orders:   ${nWO}`);
  console.log(`  opex entries:  ${nOpex}`);
  const inhouse = existingInhouse + nInhouse;
  console.log(`  in-house today: ${inhouse}/${totalUnits} units (~${Math.round((inhouse / totalUnits) * 100)}% — ${nInhouse} demo + ${existingInhouse} real)`);
  const netMargin = revenue - expenses - opexTotal;
  console.log(`  ── paid revenue (incl. refunds): ${P(revenue)}`);
  console.log(`  ── maintenance cost:             ${P(expenses)}`);
  console.log(`  ── operating expenses:           ${P(opexTotal)}`);
  console.log(`  ── net margin:                   ${P(netMargin)}  (${revenue ? Math.round((netMargin / revenue) * 100) : 0}%)`);
  console.log('\n  Tear down anytime with:  npm run db:seed:demo:reset');

  await client.end();
  process.exit(0);
}

run().catch(async (err) => {
  console.error('Demo seed failed:', err);
  try { await client.query('ROLLBACK'); await client.end(); } catch { /* noop */ }
  process.exit(1);
});
