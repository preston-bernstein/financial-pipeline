# ADR 0018 — Exclude financial-pipeline from Loki log shipping

**Status:** Accepted

**Context:** home-infra's fleet observability contract (CONVENTIONS.md §18) requires
every deployed service to either ship logs to the shared Loki instance or carry a
written, reviewed exclusion. This repo runs `pino` structured JSON to stdout across all
seven first-party services — good, and rare in the fleet — but that JSON is built
directly from live Plaid/brokerage payloads. Before this change, `services/llm-enricher/
src/enrich.ts:75` echoed the model's raw reply to a `BATCH_SIZE=30` prompt (built at
`enrich.ts:42-64` from real transaction descriptions, merchant names, and dollar amounts)
straight into a `log.warn` call whenever that reply failed to parse as JSON — one
malformed model response was enough to dump up to 30 real transactions to `docker logs`.
A second site, `enrich.ts:202` (pre-fix line number), logged a RunPod HTTP error body
verbatim, which commonly echoes the request that produced it, i.e. the same transaction
text. Both call sites are hardened in this same change (see Decision, item 3) — but that
does not by itself make shipping this repo's logs to a shared, multi-repo-queryable Loki
instance safe.

The reason redaction alone is insufficient: `packages/adapter-utils/src/logger.ts`'s
`redact` option is a key-name deny-list. It stops a value logged under a listed key
(`raw`, `body`, `description`, `merchant_name`, `account_id`, `account_number`,
`balance`, plus the fleet-wide credential keys) — it does nothing for the same value
logged under a key nobody thought to list (a future `log.debug({ prompt })` in the same
file, for instance). Across seven services and ~30 log call sites sitting directly in the
path of live bank-transaction and brokerage-session data, one missed call site is a real
PII leak into a 336h-retained, house-wide-queryable log store — a materially different
risk than the other eleven fleet repos, whose log lines are derived from public web
content or internal service state rather than a living person's financial records.

**Decision:** `financial-pipeline`'s containers are permanently excluded from Loki log
shipping. Concretely: no service in `docker-compose.yml` ever carries the
`observability.logs: "true"` label (Lane A), and — not applicable today since this repo
deploys as docker-compose rather than host systemd units, but stated for completeness —
none of its processes are ever added to a Lane B `matches` list in home-infra's
`config.alloy`. Logs stay local: `docker logs <container>` on the deploy host is the only
place they exist, subject to Docker's default log rotation. Enforcement is not left to
this repo's discipline alone — home-infra's Loki ruler runs `FinancialPipelineLogsLeaking`
(a LogQL rule against Loki's own ingested data) that fires if these logs ever reach Loki
despite this decision.

Compensating observability, in place of log shipping, per §18's requirement that
exclusion covers log shipping only, never metrics:

1. **A payload-free `/metrics` endpoint.** `services/mcp-server/src/metrics.ts`, mounted
   at `GET /metrics` in `services/mcp-server/src/index.ts` (a separate, unauthenticated
   path alongside the bearer-gated `/mcp` — it carries counts only, none of the risk that
   path's auth exists for). Computed directly from Postgres, not from in-process counters,
   so every series survives a container restart: `finpipe_run_outcome_total{source,status}`,
   `finpipe_last_run_timestamp_seconds{source}`, `finpipe_last_success_timestamp_seconds
   {source}`, `finpipe_work_quantity{source}`, `finpipe_enrichment_tier_total{tier}`,
   `finpipe_unenriched_transactions`, `finpipe_materialization_backlog`,
   `finpipe_runs_stuck_running`. Every label is a closed, low-cardinality enum (`source`,
   `status`, `tier`); none is derived from transaction content.
2. **The did-nothing rule, applied to this repo's costliest silent-failure shape.**
   `packages/adapter-utils/src/scrape-outcome.ts`'s `classifyBalanceScrape` now flags a
   balance-scraping run as `suspect` when it returns zero rows OR every scraped balance is
   exactly $0.00. `services/betterment-adapter/src/index.ts`,
   `services/vanguard-adapter/src/index.ts`, and `services/fidelity-adapter/src/index.ts`
   throw on that verdict instead of silently returning `{ rowsWritten: 0 }` — routing
   through `withRunRecord`'s existing failure path (`status='failure'` in `runs`, and the
   ntfy alert in each adapter's outer `catch` actually fires). Previously a scraper
   returning nothing, or a broken balance selector reading every goal/account as $0.00,
   was recorded as a successful run and downstream tools (`get_net_worth`, the journal)
   reported a collapsed net worth as fact. `plaid-tap` deliberately keeps 0-rows-written
   as a legitimate success — a cursor-based sync with no new transactions is a common,
   benign daily outcome, unlike a literal $0.00 across every investment account.
3. **Redaction hardened at the two worst call sites plus the logging boundary.**
   `enrich.ts`'s L1 parse-failure log (originally line 75) now emits `raw_len` and a
   dollar-amount-scrubbed `raw_head` instead of the raw model reply; its RunPod-error log
   (originally line 202, now `enrich.ts:216`) emits `body_len` instead of the raw response
   body. `packages/adapter-utils/src/logger.ts`'s
   `pino` `redact` option now also denies this repo's own PII-bearing key names
   (`raw`, `body`, `description`, `merchant_name`, `account_id`, `account_number`,
   `balance`) on top of CONVENTIONS.md §18's fleet-wide list — a second, local-only line
   of defense for `docker logs` output, not a substitute for the exclusion above.
4. **Correlation and message hygiene.** Every previously message-less `log.error({ err })`
   call (9 sites: `betterment-adapter/src/index.ts:75,80`, `vanguard-adapter/src/
   index.ts:73,78`, `fidelity-adapter/src/index.ts:74,79`, `plaid-tap/src/index.ts:143`,
   `llm-enricher/src/index.ts:75,80` — pre-fix line numbers) now carries a stable literal
   `msg` and structured `err_type`/`err_msg` (`packages/adapter-utils/src/err-fields.ts`)
   instead of a raw `Error` object. `packages/adapter-utils/src/with-run-record.ts` now
   binds `runs.id` into a child logger (`run_id`) passed into every adapter's wrapped
   function, so a local `docker logs` grep can correlate a failure line to the row already
   auditable in Postgres — previously `runs.id` existed in the DB but was never logged.

**Consequences:** Debugging a live incident in this repo means SSH + `docker logs` on the
deploy host, not the shared Grafana Explore other onboarded repos get — there is no
Grafana panel for this repo's log lines, by design. The `/metrics` endpoint requires a
home-infra change (adding `mcp-server:<port>/metrics` as a Prometheus scrape target) before
any of the series above back a dashboard panel or an alert rule; until that lands, this
ADR's compensating metrics exist in-repo but are not yet wired to Alertmanager/ntfy — a
follow-up outside this repo's scope. `FinancialPipelineLogsLeaking`
(home-infra `loki/rules/fake/observability-substrate.yaml`) is the only mechanical
backstop if this exclusion is ever accidentally violated (e.g. a future
`observability.logs: "true"` label added by mistake). `CONTEXT.md`'s Infrastructure
section previously claimed "Grafana + Loki — logs and dashboards"; this repo's bundled
Loki/Grafana containers in `docker-compose.yml` receive `LOKI_URL` but no service ever
calls it (confirmed: `createLogger` is bare `pino` to stdout), so that claim was false
coverage — worse than no coverage, per the audit that produced this ADR. `CONTEXT.md` is
corrected in the same commit as this ADR; deleting the unused `loki`/`grafana` compose
services and `LOKI_URL` env vars themselves is a separate, not-yet-scheduled cleanup
(tracked here, not done by this ADR, since it is a `docker-compose.yml` "service
behavior" change requiring its own build/deploy gate).

**Review date:** 2027-02-01, or sooner if this repo's deploy target changes from
docker-compose to something with a different log-shipping default (e.g. host systemd
units, which would route through Lane B instead of Lane A and change which home-infra
file this decision needs to stay consistent with).
