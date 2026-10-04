// Child-process helper for round4-timezone.test.ts: prints what the API would send for a
// DATE column, and for a stay written then read back, under whatever TZ it was started with.
import { sql } from 'kysely';
import { db } from '../../../src/config/db.js';

const read = await sql<{ d: Date }>`SELECT DATE '2028-02-16' AS d`.execute(db);
const written = await sql<{ d: string }>`SELECT (${new Date('2028-02-16')}::date)::text AS d`.execute(db);
console.log(JSON.stringify({ read: read.rows[0]!.d, written: written.rows[0]!.d, tz: process.env.TZ }));
await db.destroy();
