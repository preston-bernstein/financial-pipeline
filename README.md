# financial-pipeline

Pulls bank transactions and investment balances into Postgres, classifies spending with a cascading LLM enricher, and exposes net worth, spending, and a monthly narrative journal over MCP (Model Context Protocol — the standard interface AI assistants like Claude use to call external tools).

[![CI](https://github.com/preston-bernstein/financial-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/preston-bernstein/financial-pipeline/actions/workflows/ci.yml)  [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)](https://www.typescriptlang.org/)  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## How it works

```
Plaid API          Betterment / Vanguard / Fidelity
    │                        │  (Playwright, seeded session)
    ▼                        ▼
plaid-tap              *-adapter (daily)
(every 4h)                   │
    │                        │
    └───────────┬────────────┘
                 ▼
            PostgreSQL (Drizzle ORM)
                 │  pg_notify('materialization_requested')
                 ▼
            materializer (LISTEN)
                 │  re-aggregate monthly_spending
                 │  generate/refresh JournalEntry via Ollama
                 ▼
            llm-enricher (every 4h, offset 30m)
                 │  L1 qwen2.5:3b → L2 qwen2.5:7b → L3 RunPod 72B
                 │  classifies into closed 15-category vocab
                 ▼
            mcp-server (Streamable HTTP, :3101)
```

### Taps vs adapters

Two distinct ingestion patterns, chosen per source. A **tap** reads structured API data — `plaid-tap` calls Plaid's `/transactions/sync` on a cursor, idempotent upsert on `transactions.id`, every 4 hours. An **adapter** reads an unstructured web UI via Playwright — `betterment-adapter`, `vanguard-adapter`, `fidelity-adapter` — because none of those three expose a usable read API for a personal account. Adapters require a one-time seeded session (`make seed-betterment` etc.) and run daily. See [ADR 0006](docs/adr/0006-playwright-session-seeding.md) — an ADR (Architecture Decision Record) is a short write-up explaining why one specific design choice was made; this repo has seven, listed at the end of this README.

### Cascading enrichment

The LLM enricher classifies settled transactions into a closed 15-category vocabulary using three escalating tiers: a fast local pass (`qwen2.5:3b`, batch), a careful local single-transaction pass (`qwen2.5:7b`) for anything still uncategorized, and a `Qwen2.5-72B` pass hosted on RunPod (a rented cloud GPU service, used here for the largest model) only for transactions still tagged `other` after L2. Every enriched row is stamped with `llm_model` and `prompt_version` so re-runs are auditable (see [ADR 0016](docs/adr/0016-llm-enrichment-stamping.md)).

### Materialization on write

Every adapter/tap run inserts a `pending_materialization` row and fires `pg_notify('materialization_requested')`. The materializer process holds a `LISTEN` connection and re-aggregates `monthly_spending` reactively instead of polling (see [ADR 0014](docs/adr/0014-listen-notify-materializer.md)). After recomputing spending it also asks the Ollama broker to refresh the current month's `JournalEntry` — a narrative summary written using the Karpathy wiki pattern: an LLM periodically rewrites a running summary document, a technique named for AI researcher Andrej Karpathy (see [ADR 0017](docs/adr/0017-journal-wiki-pattern.md)).

## Stack

| Layer | Tech |
|---|---|
| Bank data | Plaid `/transactions/sync`, cursor-based |
| Investment data | Playwright, seeded-session scrape of Betterment/Vanguard/Fidelity |
| DB | PostgreSQL 17, Drizzle ORM (maps Postgres tables to TypeScript types) + drizzle-kit migrations |
| Reactive aggregation | Postgres `LISTEN`/`NOTIFY` |
| Enrichment | Ollama resource broker (local `qwen2.5:3b`/`qwen2.5:7b`) + RunPod serverless `Qwen2.5-72B-Instruct` |
| API | MCP server, `@modelcontextprotocol/sdk`, Streamable HTTP (MCP's plain-HTTP transport), bearer-token auth |
| Observability | Grafana + Loki (logs/dashboards), ntfy (push alerts) |
| Deploy | Docker Compose on NAS, images built and pushed via `make deploy` |

## Monorepo layout

```
packages/
  db/               Drizzle schema, migrations, Postgres client
  adapter-utils/    shared logging (pino) + helpers for taps/adapters
services/
  plaid-tap/        Plaid transaction sync
  betterment-adapter/  Playwright balance scrape
  vanguard-adapter/    Playwright balance scrape
  fidelity-adapter/    Playwright balance scrape
  fungible-tap/     (structured tap, see src for source)
  materializer/     LISTEN/NOTIFY aggregation + journal generation
  llm-enricher/     cascading transaction categorization
  mcp-server/       MCP tool surface (Streamable HTTP)
docs/adr/           architecture decisions
```

## Quick start

### Prerequisites

- Node.js 24 (see `.nvmrc`)
- Docker + Docker Compose (Postgres, Grafana, Loki, ntfy, and every service run as containers)
- An [Ollama resource broker](http://10.0.0.243:11435) reachable for enrichment/journal generation
- Plaid API credentials, and a local browser (`npx playwright install chromium`) for one-time investment-account session seeding

```bash
git clone https://github.com/preston-bernstein/financial-pipeline
cd financial-pipeline
npm install
cp .env.example .env
cp pipeline.config.example.toml pipeline.config.toml
# fill in .env and pipeline.config.toml, then seed secrets/ (postgres_password.txt,
# grafana_password.txt, plaid_credentials.json)
make seed-betterment   # repeat for vanguard, fidelity
make deploy
```

## Configuration

Infrastructure config lives in `.env` (see [`.env.example`](.env.example)); financial domain config lives in `pipeline.config.toml` (see [`pipeline.config.example.toml`](pipeline.config.example.toml)). Secrets (Postgres password, Grafana password, Plaid credentials) are read from files under `secrets/`, never from `.env`.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://pipeline@postgres:5432/pipeline` | Postgres connection string (password from `secrets/postgres_password.txt`) |
| `MCP_PORT` | `3101` | MCP server port (avoids collision with Loki's `3100`) |
| `MCP_AUTH_TOKEN` | — | Bearer token for MCP clients; unset runs the server unauthenticated (logged loudly) |
| `MCP_BIND_HOST` | `0.0.0.0` | Interface to bind the MCP port to |
| `MCP_ALLOWED_HOSTS` | — | DNS names allowed past the DNS-rebinding check (IP-literal/localhost always pass) |
| `MCP_ALLOWED_ORIGINS` | — | Browser Origins to allow (normally empty) |
| `GRAFANA_PORT` | `3200` | Grafana UI port |
| `LOKI_URL` | `http://loki:3100` | Loki endpoint for service logs |
| `NTFY_URL` | `http://ntfy:80` | ntfy server for push alerts |
| `NTFY_TOPIC` | `financial-pipeline` | ntfy topic |
| `JOURNAL_BROKER_URL` | `http://10.0.0.243:11435` | Ollama broker interactive port, journal generation |
| `OLLAMA_BROKER_URL` | `http://10.0.0.243:11436` | Ollama broker batch port, transaction enrichment |
| `JOURNAL_MODEL` | `qwen2.5` | Model for journal narrative generation |
| `ENRICHER_MODEL` | `qwen2.5:3b` | L1 enrichment tier — fast local batch pass |
| `ENRICHER_MODEL_L2` | `qwen2.5:7b` | L2 enrichment tier — careful local single-transaction pass |
| `ENRICHER_MODEL_L3` | `Qwen/Qwen2.5-72B-Instruct` | L3 enrichment tier — RunPod, only for still-`other` transactions |
| `RUNPOD_BASE_URL` | — | RunPod serverless vLLM endpoint (OpenAI-compatible) |
| `RUNPOD_API_KEY` | — | RunPod API key |

`pipeline.config.toml` additionally defines `income.monthly_net`, `savings.roth_monthly` / `savings.betterment_monthly`, per-source staleness windows (`staleness.*_hours`), and ntfy alert topics per severity.

## Deploying

```bash
make build    # buildx-build every service image (linux/amd64)
make push     # save + ssh-load images onto the NAS
make deploy   # push, then `docker compose up -d` on the NAS
```

## MCP tools

| Tool | Description |
|---|---|
| `get_monthly_spending` | Monthly totals from the materialized table, optional year/month filter |
| `get_net_worth` | Latest balance per account, summed across all sources |
| `get_goal_progress` | Betterment goal balances, staleness flag |
| `get_derived_ceiling` | Implied spending budget from `pipeline.config.toml` |
| `get_adapter_health` | Last run time and staleness per adapter |
| `get_financial_snapshot` | All key metrics in one call |
| `read_financial_journal` | LLM-generated monthly narrative entries |

## Architecture decisions

Seven ADRs in [`docs/adr/`](docs/adr/) document the key choices: Postgres over SQLite, Playwright session seeding, adapter scheduling, staleness windows, the LISTEN/NOTIFY materializer, LLM enrichment stamping, and the journal wiki pattern.

## License

MIT — see [LICENSE](LICENSE).
