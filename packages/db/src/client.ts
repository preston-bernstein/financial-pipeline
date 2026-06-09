import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { buildDbUrl } from './build-url.js';

const sql = postgres(buildDbUrl());
export const db = drizzle(sql, { schema });
export type Db = typeof db;
