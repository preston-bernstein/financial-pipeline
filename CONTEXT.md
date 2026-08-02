# financial-pipeline — domain model

This is financial-pipeline's domain reference: the entities, vocabulary, and tools that other docs and code assume you already know.

## Entities

**Transaction** — A financial event pulled from Plaid's `/transactions/sync` API. Has a stable Plaid `id`, `amount` (positive = debit, negative = credit/deposit), `date`, `description`, `merchant_name`, `category` (Plaid's taxonomy), and after enrichment: `llm_category` (restricted to the 15-category vocabulary below — a model can't invent a new category), `llm_model`, `prompt_version`. Transactions are settled (`pending=false`) or pending — only settled transactions count in spending aggregates.

**Snapshot** — A point-in-time balance capture from a browser-scraped investment account (Betterment, Vanguard, Fidelity). Has `source`, `account_id`, `account_name`, `balance`, and free-form `metadata` (goal targets, allocation). Snapshots accumulate — they're never updated, only appended. Latest-per-account is the current balance.

**Run** — A record of one adapter execution: `source`, `started_at`, `completed_at`, `status` (running|success|failure), `rows_written`, `error_message`. Used by `get_adapter_health` to compute staleness. The did-nothing rule (ADR 0018 — one of this repo's Architecture Decision Records, each a short write-up explaining one design choice): a balance-scraping adapter (betterment/vanguard/fidelity) that scraped zero rows, or scraped rows whose balances are all exactly $0.00, marks the run `status='failure'` rather than a misleadingly-successful zero — see `classifyBalanceScrape` in `packages/adapter-utils/src/scrape-outcome.ts`. `plaid-tap` is the exception: 0 rows written is a legitimate, common `success` (a sync with no new transactions), never `failure`.

**Materialization** — After any adapter run, a `pending_materialization` row is inserted and `pg_notify('materialization_requested')` fires. The materializer LISTENS and re-aggregates `monthly_spending`. One pending row per adapter run; marked `processed=true` after compute.

**MonthlySpending** — Materialized aggregate: `year`, `month`, `total` (sum of all settled transaction amounts), `by_category` (JSONB map of category→amount). UNIQUE(year, month). Re-upserted on each materialization.

**JournalEntry** — One LLM-generated narrative per calendar month, written using the Karpathy wiki pattern (an LLM periodically rewrites a running summary document — a technique named for AI researcher Andrej Karpathy). The materializer calls the Ollama broker after recomputing spending to generate/refresh the current month's entry. UNIQUE(month_key). Exposed via the `read_financial_journal` MCP (Model Context Protocol — the standard interface AI assistants use to call tools) tool.

## Taps vs Adapters

**Tap** — Reads structured API data. Currently: `plaid-tap` (bank transactions via Plaid `/transactions/sync`). Runs every 4h, cursor-based, idempotent upsert on `transactions.id`.

**Adapter** — Reads unstructured web UI via Playwright. Currently: `betterment-adapter`, `vanguard-adapter`, `fidelity-adapter`. Require a seeded session (one-time manual login via `--seed-session` flag). Run daily.

## Enricher

**LLM Enricher** — Post-ingestion pass using Ollama (batch broker port 11436). Classifies settled transactions without an `llm_category` into a closed 15-category vocabulary. Runs every 4h (offset 30 min from plaid-tap). `--backfill` resets and re-classifies all transactions. Stamps `llm_model` and `prompt_version` on every enriched row (per ADR 0016 pattern).

## Category Vocabulary (closed, 15 categories)

`groceries`, `restaurants`, `transportation`, `utilities`, `healthcare`, `entertainment`, `shopping`, `housing`, `subscriptions`, `travel`, `transfers`, `income`, `education`, `personal_care`, `other`

## Derived Ceiling

`ceiling = monthly_net - (roth_monthly + betterment_monthly)`

Where `monthly_net` = take-home pay after taxes and the pre-tax 401(k) deduction (a 401(k) is a US employer-sponsored retirement account funded before tax). Defined in `pipeline.config.toml`. The `get_derived_ceiling` MCP tool exposes this.

## MCP Tools

| Tool | Description |
|---|---|
| `get_monthly_spending` | Monthly totals from materialized table, optional year/month filter |
| `get_net_worth` | Latest balance per account, summed across all sources |
| `get_goal_progress` | Betterment goal balances, staleness flag |
| `get_derived_ceiling` | Implied spending budget from config |
| `get_adapter_health` | Last run time and staleness per adapter (stale reflects outcome, not just recency — a failed run never reads as fresh) |
| `get_financial_snapshot` | All key metrics in one call |
| `read_financial_journal` | LLM-generated monthly narrative entries |

## Observability

This repo is **deliberately excluded** from the shared home-lab Loki instance (Loki is a
log storage system used elsewhere in this home lab; ADR 0018) — it handles live
Plaid/brokerage data, and the `redact` deny-list built into pino (the Node.js logging
library this repo uses) — keyed by log field name, defined in
`packages/adapter-utils/src/logger.ts` — is not trusted alone to keep that data out of a
shared, multi-repo-queryable log store. Logs stay local: `docker logs <container>` on the
deploy host is the only place they exist. Compensating coverage instead of log shipping:
a payload-free `GET /metrics` endpoint on `mcp-server` (`services/mcp-server/src/
metrics.ts`), computed directly from Postgres — run outcomes, staleness timestamps,
enrichment cascade tier distribution, unenriched/materialization backlog, stuck-running
count. See ADR 0018 for the full rationale and the did-nothing-rule fix (a scrape that
found nothing is now a failed run, not a silent success) that accompanies it.

## Infrastructure

- PostgreSQL (Docker, NAS) — primary store
- Drizzle ORM + drizzle-kit migrations
- `docker-compose.yml` also bundles a private Loki + Grafana (a dashboarding tool) pair; nothing in this repo
  ships logs to it (confirmed: `createLogger` is bare `pino` to stdout, `LOKI_URL` is
  injected into every service's environment but read by zero lines of TypeScript) —
  removing those unused services is a known, not-yet-scheduled cleanup (ADR 0018,
  Consequences). Do not treat their presence as log coverage.
- ntfy — push alerts on adapter failure
- Ollama resource broker (desktop 10.0.0.243) — arbitrates LLM inference across one
  shared GPU; never call the raw Ollama port `:11434` directly
  - `:11435` — interactive / journal generation
  - `:11436` — batch enrichment
- MCP server on NAS port 3101, using Streamable HTTP (MCP's plain-HTTP transport, at `/mcp`), bearer-token auth + Host/Origin allowlisting (`MCP_AUTH_TOKEN`, `MCP_ALLOWED_HOSTS`, `MCP_ALLOWED_ORIGINS` in `.env`)
