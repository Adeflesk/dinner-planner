import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

// Driver-agnostic type so services work against Neon (prod) and PGlite (tests).
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let _db: Db | null = null;
export function getDb(): Db {
  if (!_db) _db = drizzle(neon(process.env.DATABASE_URL!), { schema }) as unknown as Db;
  return _db;
}
