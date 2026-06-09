CREATE TABLE "monthly_spending" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"by_category" jsonb,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_materialization" (
	"id" serial PRIMARY KEY NOT NULL,
	"triggered_by" varchar NOT NULL,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"processed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar NOT NULL,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"status" varchar NOT NULL,
	"rows_written" integer,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar NOT NULL,
	"account_id" varchar NOT NULL,
	"account_name" varchar NOT NULL,
	"balance" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"metadata" jsonb,
	"captured_at" timestamp NOT NULL,
	"ingested_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" varchar PRIMARY KEY NOT NULL,
	"account_id" varchar NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"date" date NOT NULL,
	"description" varchar NOT NULL,
	"merchant_name" varchar,
	"category" varchar,
	"pending" boolean DEFAULT false NOT NULL,
	"source" varchar DEFAULT 'plaid' NOT NULL,
	"ingested_at" timestamp DEFAULT now() NOT NULL
);
