import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { buildDbUrl } from './build-url.js';

const sql = postgres(buildDbUrl(), { max: 1 });
const db = drizzle(sql);

await migrate(db, { migrationsFolder: './migrations' });
console.log('migrations applied');
await sql.end();
