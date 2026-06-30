# financial-pipeline — domain model

## Entities

**Transaction** — A financial event pulled from Plaid's `/transactions/sync` API. Has a stable Plaid `id`, `amount` (positive = debit, negative = credit/deposit), `date`, `description`, `merchant_name`, `category` (Plaid's taxonomy), and after enrichment: `llm_category` (closed-vocab), `llm_model`, `prompt_version`. Transactions are settled (`pending=false`) or pending — only settled transactions count in spending aggregates.

**Snapshot** — A point-in-time balance capture from a browser-scraped investment account (Betterment, Vanguard, Fidelity). Has `source`, `account_id`, `account_name`, `balance`, and free-form `metadata` (goal targets, allocation). Snapshots accumulate — they're never updated, only appended. Latest-per-account is the current balance.

**Run** — A record of one adapter execution: `source`, `started_at`, `completed_at`, `status` (running|success|failure), `rows_written`, `error_message`. Used by `get_adapter_health` to compute staleness.

**Materialization** — After any adapter run, a `pending_materialization` row is inserted and `pg_notify('materialization_requested')` fires. The materializer LISTENS and re-aggregates `monthly_spending`. One pending row per adapter run; marked `processed=true` after compute.

**MonthlySpending** — Materialized aggregate: `year`, `month`, `total` (sum of all settled transaction amounts), `by_category` (JSONB map of category→amount). UNIQUE(year, month). Re-upserted on each materialization.

**JournalEntry** — One LLM-generated narrative per calendar month (Karpathy wiki pattern). The materializer calls the Ollama broker after recomputing spending to generate/refresh the current month's entry. UNIQUE(month_key). Exposed via `read_financial_journal` MCP tool.

## Taps vs Adapters

**Tap** — Reads structured API data. Currently: `plaid-tap` (bank transactions via Plaid `/transactions/sync`). Runs every 4h, cursor-based, idempotent upsert on `transactions.id`.

**Adapter** — Reads unstructured web UI via Playwright. Currently: `betterment-adapter`, `vanguard-adapter`, `fidelity-adapter`. Require a seeded session (one-time manual login via `--seed-session` flag). Run daily.

## Enricher

**LLM Enricher** — Post-ingestion pass using Ollama (batch broker port 11436). Classifies settled transactions without an `llm_category` into a closed 15-category vocabulary. Runs every 4h (offset 30 min from plaid-tap). `--backfill` resets and re-classifies all transactions. Stamps `llm_model` and `prompt_version` on every enriched row (per ADR 0016 pattern).

## Category Vocabulary (closed, 15 categories)

`groceries`, `restaurants`, `transportation`, `utilities`, `healthcare`, `entertainment`, `shopping`, `housing`, `subscriptions`, `travel`, `transfers`, `income`, `education`, `personal_care`, `other`

## Derived Ceiling

`ceiling = monthly_net - (roth_monthly + betterment_monthly)`

Where `monthly_net` = take-home after taxes and pre-tax 401k deduction. Defined in `pipeline.config.toml`. The `get_derived_ceiling` MCP tool exposes this.

## MCP Tools

| Tool | Description |
|---|---|
| `get_monthly_spending` | Monthly totals from materialized table, optional year/month filter |
| `get_net_worth` | Latest balance per account, summed across all sources |
| `get_goal_progress` | Betterment goal balances, staleness flag |
| `get_derived_ceiling` | Implied spending budget from config |
| `get_adapter_health` | Last run time and staleness per adapter |
| `get_financial_snapshot` | All key metrics in one call |
| `read_financial_journal` | LLM-generated monthly narrative entries |

## Infrastructure

- PostgreSQL (Docker, NAS) — primary store
- Drizzle ORM + drizzle-kit migrations
- Grafana + Loki — logs and dashboards
- ntfy — push alerts on adapter failure
- Ollama resource broker (desktop 10.0.0.243) — LLM inference (never raw :11434)
  - `:11435` — interactive / journal generation
  - `:11436` — batch enrichment
- MCP server on NAS port 3101, SSE transport
