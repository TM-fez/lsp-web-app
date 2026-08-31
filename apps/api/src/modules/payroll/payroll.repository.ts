import { Kysely, sql } from 'kysely';
import type { Database, NewStaffCompensation } from '../../db/types.js';
import type { PayrollRequestMeta } from './payroll.types.js';

type CompFields = Omit<NewStaffCompensation, 'user_id' | 'created_by' | 'updated_by'>;

export class PayrollRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // Every active staff member, with their compensation if it's been set.
  listEmployees() {
    return this.db
      .selectFrom('users as u')
      .innerJoin('roles as r', 'r.id', 'u.role_id')
      .leftJoin('staff_compensation as sc', 'sc.user_id', 'u.id')
      .select([
        'u.id as user_id', 'u.name', 'u.is_lead', 'r.name as role',
        'sc.job_title', 'sc.gross_amount', 'sc.frequency', 'sc.payment_method',
        'sc.bank_name', 'sc.bank_account',
        sql<string | null>`to_char(sc.start_date, 'YYYY-MM-DD')`.as('start_date'),
        'sc.notes', 'sc.active as comp_active',
      ])
      .where('u.active', '=', true)
      .orderBy('u.name')
      .execute();
  }

  getComp(userId: string) {
    return this.db.selectFrom('staff_compensation').selectAll().where('user_id', '=', userId).executeTakeFirst();
  }

  // A salary write and its audit row commit together. Read `existed` inside the
  // transaction too: deciding CREATE vs UPDATE from a read taken outside it could label
  // the row wrongly if the same staff member's pay were set twice at once.
  async upsert(userId: string, fields: CompFields, meta: PayrollRequestMeta) {
    await this.db.transaction().execute(async (trx) => {
      const existed = await trx
        .selectFrom('staff_compensation')
        .select('user_id')
        .where('user_id', '=', userId)
        .executeTakeFirst();

      await trx
        .insertInto('staff_compensation')
        .values({ user_id: userId, ...fields, created_by: meta.userId, updated_by: meta.userId })
        .onConflict((oc) =>
          oc.column('user_id').doUpdateSet({ ...fields, updated_by: meta.userId, updated_at: sql`now()` }),
        )
        .execute();

      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: existed ? 'UPDATE' : 'CREATE',
        entity: 'staff_compensation',
        entity_id: userId,
        diff: JSON.stringify(fields),
        ip_address: meta.ip ?? null,
      }).execute();
    });
    return this.getComp(userId);
  }

  // Monthly equivalent total + headcount for active comp.
  async summary() {
    const r = await sql<{ headcount: string; monthly_total: string | null }>`
      SELECT count(*) AS headcount,
             SUM(CASE WHEN frequency = 'WEEKLY' THEN round(gross_amount * 52.0 / 12) ELSE gross_amount END) AS monthly_total
      FROM staff_compensation WHERE active`.execute(this.db);
    return r.rows[0]!;
  }

  async byRole() {
    const r = await sql<{ role: string; headcount: string; monthly: string | null }>`
      SELECT r.name AS role, count(*) AS headcount,
             SUM(CASE WHEN sc.frequency = 'WEEKLY' THEN round(sc.gross_amount * 52.0 / 12) ELSE sc.gross_amount END) AS monthly
      FROM staff_compensation sc
      JOIN users u ON u.id = sc.user_id
      JOIN roles r ON r.id = u.role_id
      WHERE sc.active
      GROUP BY r.name ORDER BY monthly DESC NULLS LAST`.execute(this.db);
    return r.rows;
  }

  /** Has the auto payroll cost already been posted for this YYYY-MM? */
  async payrollPostedFor(month: string) {
    const row = await this.db
      .selectFrom('operating_expenses')
      .select('id')
      .where('notes', '=', `payroll:${month}`)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return !!row;
  }

  async postPayrollOpex(month: string, incurredOn: Date, amount: number, description: string, meta: PayrollRequestMeta) {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('operating_expenses')
        .values({
          property_id: null,
          category: 'PAYROLL',
          description,
          vendor: 'Payroll',
          amount,
          currency: 'BWP',
          incurred_on: incurredOn,
          notes: `payroll:${month}`,
          created_by: meta.userId,
          updated_by: meta.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'CREATE',
        entity: 'operating_expense',
        entity_id: row.id,
        diff: JSON.stringify({ payroll_posted: month, amount }),
        ip_address: meta.ip ?? null,
      }).execute();

      return row.id;
    });
  }
}
