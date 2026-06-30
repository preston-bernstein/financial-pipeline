ALTER TABLE "transactions" ADD COLUMN "llm_category" varchar;
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "llm_model" varchar;
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "prompt_version" varchar;
--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_spending_year_month_unique" ON "monthly_spending" ("year","month");
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"month_key" varchar NOT NULL,
	"content" text NOT NULL,
	"model" varchar NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_month_key_unique" UNIQUE("month_key")
);
