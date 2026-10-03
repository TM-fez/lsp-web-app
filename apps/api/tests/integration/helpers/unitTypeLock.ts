import pg from 'pg';

/**
 * Serialise suites that need the ONE active rate plan of a unit type.
 *
 * `rate_plans_active_unit_type_unique` allows a single active plan per unit type, and
 * vitest runs test files in parallel against one database — so two files that both
 * insert an active SUITE plan intermittently collided (the pay-later / revenue-recognition
 * flake). A Postgres session advisory lock, held on a dedicated connection from the
 * file's beforeAll until its afterAll has deleted its plan, makes the second file wait
 * instead of fail. Release it AFTER the cleanup, never before.
 */
export async function lockUnitType(unitType: string): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('SELECT pg_advisory_lock(hashtext($1))', [`rate_plan:${unitType}`]);
  return async () => {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`rate_plan:${unitType}`]).catch(() => undefined);
    await client.end().catch(() => undefined);
  };
}
