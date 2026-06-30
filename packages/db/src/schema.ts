import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const transactions = pgTable('transactions', {
  id: varchar('id').primaryKey(), // Plaid transaction ID
  account_id: varchar('account_id').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  date: date('date').notNull(),
  description: varchar('description').notNull(),
  merchant_name: varchar('merchant_name'),
  category: varchar('category'),
  pending: boolean('pending').notNull().default(false),
  source: varchar('source').notNull().default('plaid'),
  ingested_at: timestamp('ingested_at').notNull().defaultNow(),
  llm_category: varchar('llm_category'),
  llm_model: varchar('llm_model'),
  prompt_version: varchar('prompt_version'),
});

export const snapshots = pgTable('snapshots', {
  id: serial('id').primaryKey(),
  source: varchar('source').notNull(), // betterment | vanguard | fidelity
  account_id: varchar('account_id').notNull(),
  account_name: varchar('account_name').notNull(),
  balance: numeric('balance', { precision: 12, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  metadata: jsonb('metadata'), // goal name, allocation breakdown, etc.
  captured_at: timestamp('captured_at').notNull(),
  ingested_at: timestamp('ingested_at').notNull().defaultNow(),
});

export const runs = pgTable('runs', {
  id: serial('id').primaryKey(),
  source: varchar('source').notNull(),
  started_at: timestamp('started_at').notNull(),
  completed_at: timestamp('completed_at'),
  status: varchar('status').notNull(), // running | success | failure
  rows_written: integer('rows_written'),
  error_message: text('error_message'),
});

// triggers materializer via LISTEN/NOTIFY after each adapter run (ADR 0014)
export const pending_materialization = pgTable('pending_materialization', {
  id: serial('id').primaryKey(),
  triggered_by: varchar('triggered_by').notNull(),
  triggered_at: timestamp('triggered_at').notNull().defaultNow(),
  processed: boolean('processed').notNull().default(false),
});

export const monthly_spending = pgTable('monthly_spending', {
  id: serial('id').primaryKey(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  total: numeric('total', { precision: 12, scale: 2 }).notNull(),
  by_category: jsonb('by_category'),
  computed_at: timestamp('computed_at').notNull().defaultNow(),
}, (t) => ({
  yearMonthUnique: uniqueIndex('monthly_spending_year_month_unique').on(t.year, t.month),
}));

export const journal_entries = pgTable('journal_entries', {
  id: serial('id').primaryKey(),
  month_key: varchar('month_key').notNull().unique(),
  content: text('content').notNull(),
  model: varchar('model').notNull(),
  generated_at: timestamp('generated_at').notNull().defaultNow(),
});
