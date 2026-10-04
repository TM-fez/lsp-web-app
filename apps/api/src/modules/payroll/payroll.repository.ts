import { Kysely, sql } from 'kysely';
import type { Database, NewStaffCompensation } from '../../db/types.js';
import type { PayrollRequestMeta } from './payroll.types.js';
import type { PropertyScope } from '../../core/scope/propertyScope.js';

type CompFields = Omit<NewStaffCompensation, 'user_id' | 'created_by' | 'updated_by'>;

/**
 * (Round 4, N-3) Payroll property scope. A staff member is "in" a property when they have a
 * `user_properties` membership there. Someone who can see every property (admin, or a
 * member of all of them) sees everyone, including staff with no membership at all. A
 * property-limited user sees only staff who work in at least one of their properties —
 * pay for a Village cleaner is not a CBD manager's business.
 */
function staffVisibleSql(scope: PropertyScope) {
  if (scope.allProperties) return sql<boolean>`true`;
  const ids = scope.ids ?? [];
  if (ids.length === 0) return sql<boolean>`false`;
  return sql<boolean>`EXISTS (
    SELECT 1 FROM user_properties vup WHERE vup.user_id = u.id AND vup.property_id IN (${sql.join(ids)})
  )`;
}

const MONTHLY_EQUIV = sql`CASE WHEN sc.frequency = 'WEEKLY' THEN round(sc.gross_amount * 52.0 / 12) ELSE sc.gross_amount END`;

export class PayrollRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // Every active staff member in the caller's scope, with their compensation if it's been set.
  listEmployees(scope: PropertyScope) {
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
      .where(staffVisibleSql(scope))
      .orderBy('u.name')
      .execute();
  }

  /** Is this (existing, active) staff member inside the caller's payroll scope? */
  async employeeVisible(userId: string, scope: PropertyScope): Promise<boolean> {
    const row = await this.db
      .selectFrom('users as u')
      .select('u.id')
      .where('u.id', '=', userId)
      .where('u.active', '=', true)
      .where(staffVisibleSql(scope))
      .executeTakeFirst();
    return !!row;
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

  // Monthly equivalent total + headcount for active comp, within the caller's scope.
  async summary(scope: PropertyScope) {
    const r = await sql<{ headcount: string; monthly_total: string | null }>`
      SELECT count(*) AS headcount, SUM(${MONTHLY_EQUIV}) AS monthly_total
      FROM staff_compensation sc JOIN users u ON u.id = sc.user_id
      WHERE sc.active AND ${staffVisibleSql(scope)}`.execute(this.db);
    return r.rows[0]!;
  }

  async byRole(scope: PropertyScope) {
    const r = await sql<{ role: string; headcount: string; monthly: string | null }>`
      SELECT r.name AS role, count(*) AS headcount, SUM(${MONTHLY_EQUIV}) AS monthly
      FROM staff_compensation sc
      JOIN users u ON u.id = sc.user_id
      JOIN roles r ON r.id = u.role_id
      WHERE sc.active AND ${staffVisibleSql(scope)}
      GROUP BY r.name ORDER BY monthly DESC NULLS LAST`.execute(this.db);
    return r.rows;
  }

  /**
   * Monthly pay per property for a limited user's post-to-costs. Each staff member is
   * charged to exactly ONE of the caller's properties — the first by name among those they
   * belong to — so a person who works in two properties is never counted twice inside one
   * posting. (Across two different people's postings of the same month this can still
   * overlap; the PR notes it.) Never returns a "no property" bucket.
   */
  async monthlyByCallerProperty(scope: PropertyScope) {
    const ids = scope.ids ?? [];
    if (ids.length === 0) return [];
    const r = await sql<{ property_id: string; monthly: string }>`
      SELECT alloc.property_id, SUM(${MONTHLY_EQUIV}) AS monthly
      FROM staff_compensation sc
      JOIN users u ON u.id = sc.user_id
      JOIN LATERAL (
        SELECT up.property_id FROM user_properties up
          JOIN properties p ON p.id = up.property_id
         WHERE up.user_id = u.id AND up.property_id IN (${sql.join(ids)})
         ORDER BY p.name, p.id LIMIT 1
      ) alloc ON true
      WHERE sc.active
      GROUP BY alloc.property_id`.execute(this.db);
    return r.rows.map((x) => ({ property_id: x.property_id, monthly: Number(x.monthly) }));
  }

  /**
   * Has payroll for this YYYY-MM already been posted in a way that clashes with the caller?
   * Markers: `payroll:YYYY-MM` = the company-level posting (all-property callers);
   * `payroll:YYYY-MM:<propertyId>` = one property's share (limited callers).
   * - an all-property post clashes with ANY posting for the month (it would double count);
   * - a limited post clashes with the company-level posting and with its own properties' shares.
   */
  async payrollPostedFor(month: string, scope: PropertyScope): Promise<boolean> {
    let q = this.db
      .selectFrom('operating_expenses')
      .select('id')
      .where('deleted_at', 'is', null)
      .where('category', '=', 'PAYROLL');
    if (scope.allProperties) {
      q = q.where((eb) => eb.or([eb('notes', '=', `payroll:${month}`), eb('notes', 'like', `payroll:${month}:%`)]));
    } else {
      const markers = [`payroll:${month}`, ...(scope.ids ?? []).map((id) => `payroll:${month}:${id}`)];
      q = q.where('notes', 'in', markers);
    }
    return !!(await q.executeTakeFirst());
  }

  /**
   * Post payroll as operating costs. `lines` has one entry per cost: a single
   * NULL-property company cost for an all-property caller, or one cost per property for a
   * limited caller (property_id never null for them). All rows + audit commit together.
   */
  async postPayrollOpex(
    month: string,
    incurredOn: Date,
    lines: Array<{ propertyId: string | null; amount: number; description: string }>,
    meta: PayrollRequestMeta
  ) {
    return this.db.transaction().execute(async (trx) => {
      const ids: string[] = [];
      for (const line of lines) {
        const row = await trx
          .insertInto('operating_expenses')
          .values({
            property_id: line.propertyId,
            category: 'PAYROLL',
            description: line.description,
            vendor: 'Payroll',
            amount: line.amount,
            currency: 'BWP',
            incurred_on: incurredOn,
            notes: line.propertyId ? `payroll:${month}:${line.propertyId}` : `payroll:${month}`,
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
          diff: JSON.stringify({ payroll_posted: month, amount: line.amount, property_id: line.propertyId }),
          ip_address: meta.ip ?? null,
        }).execute();
        ids.push(row.id);
      }
      return ids;
    });
  }

  /** Names for the per-property cost descriptions. */
  async propertyNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.selectFrom('properties').select(['id', 'name']).where('id', 'in', ids).execute();
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
