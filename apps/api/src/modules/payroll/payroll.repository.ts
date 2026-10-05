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

/**
 * (R5, migration 086) The one property a staff member's pay is costed to: their chosen
 * home, else the first property they work in (by name) — the rule the backfill wrote down
 * — else none (a company-level cost). Every posting uses this, so a person who works in
 * two properties is costed once, whoever posts.
 */
const HOME_PROPERTY = sql<string | null>`COALESCE(sc.home_property_id, (
  SELECT up.property_id FROM user_properties up JOIN properties p ON p.id = up.property_id
   WHERE up.user_id = sc.user_id ORDER BY p.name, p.id LIMIT 1))`;

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
        sql<string | null>`${HOME_PROPERTY}`.as('home_property_id'),
        sql<string | null>`(SELECT hp.name FROM properties hp WHERE hp.id = ${HOME_PROPERTY})`.as('home_property_name'),
        // The properties they work in — the choices for their home property.
        sql<Array<{ id: string; name: string }>>`COALESCE((
          SELECT json_agg(json_build_object('id', mp.id, 'name', mp.name) ORDER BY mp.name)
            FROM user_properties mup JOIN properties mp ON mp.id = mup.property_id
           WHERE mup.user_id = u.id AND mp.active), '[]'::json)`.as('member_properties'),
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
   * (R5) Monthly pay grouped by HOME property — the only allocation any posting uses.
   * An all-property caller gets every bucket, including `null` (staff with no property,
   * a company-level cost); a limited caller gets only the homes inside their properties.
   * Because each person has exactly one home, the buckets never overlap: the sum over
   * properties is the company total, whoever posts which part.
   */
  async monthlyByHomeProperty(scope: PropertyScope) {
    const r = await sql<{ property_id: string | null; monthly: string }>`
      SELECT home.property_id, SUM(${MONTHLY_EQUIV}) AS monthly
      FROM staff_compensation sc
      JOIN users u ON u.id = sc.user_id
      CROSS JOIN LATERAL (SELECT ${HOME_PROPERTY} AS property_id) home
      WHERE sc.active
      GROUP BY home.property_id`.execute(this.db);
    const rows = r.rows.map((x) => ({ property_id: x.property_id, monthly: Number(x.monthly) }));
    if (scope.allProperties) return rows;
    const mine = new Set(scope.ids ?? []);
    return rows.filter((x) => x.property_id !== null && mine.has(x.property_id));
  }

  /**
   * The payroll markers already posted for a YYYY-MM: `payroll:YYYY-MM` = the company-level
   * cost (staff with no property, or a whole-company posting from before R5), and
   * `payroll:YYYY-MM:<propertyId>` = one property's share.
   */
  async postedMarkers(month: string): Promise<Set<string>> {
    const rows = await this.db
      .selectFrom('operating_expenses')
      .select('notes')
      .where('deleted_at', 'is', null)
      .where('category', '=', 'PAYROLL')
      .where((eb) => eb.or([eb('notes', '=', `payroll:${month}`), eb('notes', 'like', `payroll:${month}:%`)]))
      .execute();
    return new Set(rows.map((r) => r.notes ?? ''));
  }

  /** Is this an active property the staff member works in? (Their home must be one.) */
  async isMemberOf(userId: string, propertyId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('user_properties as up')
      .innerJoin('properties as p', 'p.id', 'up.property_id')
      .select('up.property_id')
      .where('up.user_id', '=', userId)
      .where('up.property_id', '=', propertyId)
      .where('p.active', '=', true)
      .executeTakeFirst();
    return !!row;
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
