# Repo Challenge — financial-pipeline (2026-07-02)

Adversarial quality review: 8 parallel challenger agents (architecture, correctness, security, DRY, performance, readability, tests, API/DX), grounded in a live web research pass (sources at bottom). 55 raw findings → 46 accepted after triage (7 MUST / 24 SHOULD / 15 NIT), 9 rejected as false positives or contradicting documented decisions. Correctness and security findings were verified against actual library source in `node_modules` (@modelcontextprotocol/sdk 1.29.0, drizzle-orm 0.38.4) and git history, not inferred.

## Verdict

The codebase is healthy for its age and scale: clean dependency direction, a textbook transactional outbox (ADR 0014 correctly implemented), disciplined secrets handling with verifiably clean git history, and pure computation consistently separated from I/O. The concentration of defects is in the **MCP server's transport layer** — the POST routing cannot match what the SDK's SSE transport actually advertises to clients, so per code analysis every standard client 404s on every tool call, and a second concurrent SSE connection crashes the process. That is the single highest-leverage fix. Second-order: the enricher's error paths permanently stamp `other` into rows that are then never retried — silent, compounding data corruption in the tables the whole system exists to serve.

## What's genuinely good

- `withRunRecord` (packages/adapter-utils/src/with-run-record.ts:20-29) — run status + `pending_materialization` insert + `pg_notify` in one transaction, with a WHY comment explaining the commit-ordering guarantee. Three agents independently praised it.
- Secrets discipline: Docker secrets throughout, `_FILE` env patterns, everything sensitive gitignored from commit one. Git forensics confirmed **no secret has ever entered history** (only `secrets/.gitkeep` tracked).
- The LLM boundary is defended where it counts: every tier's output is clamped to the closed 15-category vocabulary before touching the DB; the journal prompt is built from numeric aggregates, not raw transaction text — which is exactly why the merchant-name → journal prompt-injection chain we attacked **does not exist** (see Rejected).
- `enrich.test.ts` covers the full L1→L2→L3 cascade including per-tier failure paths, and `compute.test.ts` tests behavior (credits, empty input, both staleness boundaries), not call shapes.
- Dependency direction is uniformly clean: services → adapter-utils → db, no cycles, no service-to-service imports.

## MUST (correctness / security)

1. **[correctness] services/mcp-server/src/index.ts:52-54 — MCP POST routing can never match a standard client.** The SDK's `SSEServerTransport` advertises the post endpoint to clients as `/messages?sessionId=<uuid>` (verified in sdk sse.js:73-77), so every client POST carries a query string and `req.url === '/messages'` exact-match 404s; additionally the session id is read from an `x-session-id` header that MCP clients never send. All 7 tools are unreachable over SSE with any spec-conforming client. Fix: `const u = new URL(req.url!, 'http://localhost'); if (u.pathname === '/messages')` and `u.searchParams.get('sessionId')`. (confidence H; SDK source. If a client HAS connected successfully in practice, verify what it actually sends — code analysis says it can't work.)
2. **[correctness] services/mcp-server/src/index.ts:43-61 — unhandled rejections crash the server.** The async `createServer` handler has no try/catch and one shared `McpServer`: a second concurrent `GET /sse` throws `"Already connected to a transport"` (sdk protocol.js:220-222) → unhandledRejection → process exit on modern Node. Fix: try/catch around the handler body; create a fresh `McpServer` per SSE connection (the SDK's documented pattern). (H; SDK source)
3. **[correctness] services/llm-enricher/src/enrich.ts:148,158,199,209 — LLM transport failures are permanently stamped as `other`.** L2/L3 error paths return `'other'`, which gets written with `llm_model`/`prompt_version`; the enricher only ever selects `isNull(llm_category)`, so the row is never retried. A broker restart mid-run mislabels every escalated transaction in that run forever and silently pollutes `monthly_spending.by_category`. Fix: distinguish transport failure (skip the DB write → retried next cron) from a genuine model "other" verdict. (H)
4. **[correctness] services/betterment-adapter/src/scrape.ts:27-30 — selector fallback chain is dead code.** `Array.from(...) || Array.from(...)` never falls through because an empty array is truthy; if the page renders `goal-card` instead of `goal-tile`, `waitForSelector` passes (it ORs all variants) but extraction returns 0 goals — silent empty run. vanguard-adapter/src/scrape.ts:26-30 already does this correctly with a `.length > 0` ternary; match it. (H; also flagged independently by the readability pass as a comment/behavior mismatch)
5. **[security] services/plaid-tap/src/index.ts:20,28,58,109 — Plaid access tokens persisted in cleartext as JSON keys** in `/data/plaid_cursors.json` on an ordinary Docker volume, outside the `/run/secrets` boundary everything else respects; rotated tokens are never pruned from the file. Fix: key the cursor store by Plaid `item_id` (or `sha256(access_token)`), prune stale keys — or move cursor state into Postgres where all other pipeline state lives. (H)
6. **[security] Makefile:34-68 (seed-* targets) — live brokerage session cookies staged world-readable in /tmp on both machines and never deleted.** storageState JSON (full Betterment/Vanguard/Fidelity sessions) is written to Mac `/tmp`, scp'd to NAS `/tmp`, bind-mounts all of NAS `/tmp` into the copy container, and survives until reboot. Fix: `mktemp` + `chmod 600`, stream via ssh stdin (`cat f | ssh ... docker run -i ... 'cat > /session/x.json'`), `rm -f` both sides. (H)
7. **[security] services/mcp-server/src/index.ts:43-63 + docker-compose.yml ports — MCP server on 0.0.0.0:3101 with no auth and no Origin validation.** Any LAN/tailnet device reads net worth, journal, and exact income (`get_derived_ceiling` exposes `monthly_net`); absent Origin checks, a malicious website in any LAN browser can reach it via DNS rebinding (the MCP spec explicitly requires Origin validation for HTTP transports), making this effectively remotely reachable. Fix: static bearer-token check + Origin/Host allowlist; bind the published port to the Tailscale IP instead of 0.0.0.0. (H; MCP spec 2025-03-26. Calibrated for a home LAN — it's still MUST because the rebinding vector crosses the LAN boundary and the data is complete financial state.)

## SHOULD (health / maintainability)

**Data correctness over time**

- [correctness] services/plaid-tap/src/index.ts:101-103 — `data.removed` is logged and dropped; Plaid-removed settled transactions (reversals, voided pre-auths) keep counting in `monthly_spending` forever. The log message shows this is a known TODO — it has real monthly-total drift cost; delete removed ids in the same run. (H)
- [correctness] services/plaid-tap/src/index.ts:87-96 — upsert conflict-set omits `date`: a pending→posted transition that shifts the date leaves the tx aggregated in the wrong month permanently. Add `date` to the set. (M)
- [correctness] services/materializer/src/compute.ts:29-42 + journal.ts:41 — `monthly_spending.total` includes income (negative) and transfers, per CONTEXT.md's definition — but the journal prompt labels it "Monthly spending: $X" (and topCats explicitly excludes income/transfers, proving the intent mismatch). A payroll month reads "spending: $-3000". Either exclude income/transfers from `total` or relabel it net cash flow everywhere it surfaces. (H)
- [correctness] services/betterment-adapter/src/scrape.ts:49-59 + get-net-worth.ts — `account_id` is a slug of the goal *name*: renaming a goal mints a new account and `DISTINCT ON` then counts both the old and new snapshots in net worth forever; `get_net_worth` has no staleness bound, so closed accounts also count at last-known balance indefinitely. Use stable upstream ids where available; exclude snapshots older than the source's staleness window. (H)
- [correctness] services/betterment-adapter/src/scrape.ts:49-57 — an unmatched balance element defaults to `'0'` and the filter keeps it (name matched) → a $0.00 snapshot becomes the goal's latest, silently cratering net worth until the selector is fixed. Track found-ness; drop rows with no balance element. (M)
- [correctness] services/llm-enricher/src/enrich.ts:79-85 — `parseL1Response` trusts model-returned 1-based ids with no uniqueness/coverage validation; id drift misattributes categories that are then stamped and never revisited. Reject the chunk (escalate all to L2) when ids aren't a unique subset of 1..n. (M)
- [architecture] plaid-tap upsert ↔ llm-enricher — modified transactions (description/category rewritten at settlement) never get `llm_category` cleared, so they keep a stale classification forever. Null `llm_category` in the `onConflictDoUpdate` set. (M)

**Materializer durability & concurrency**

- [correctness] services/materializer/src/index.ts:167-176 — cold-start drain runs *before* `LISTEN` is established, so NOTIFYs in that window are dropped (row waits up to 4h for the next adapter run); and postgres.js fires listen callbacks unserialized, so overlapping `materialize()` runs race — including the check-then-insert in `maybeGenerateJournal`, where two concurrent runs both pay for an LLM generation. Establish LISTEN before draining; add an in-flight mutex with a rerun flag. (H)
- [architecture] services/materializer/src/index.ts — no reconciliation backstop: if the LISTEN connection drops or `materialize()` fails (rows stay `processed=false`, no retry), unprocessed rows sit until the next adapter run or restart. Add a periodic sweep (10–15 min `setInterval` calling `materialize()`) — the durability backstop non-durable NOTIFY needs. (H; LISTEN/NOTIFY sources below)
- [correctness] packages/adapter-utils/src/with-run-record.ts:33-35 — the failure-path status update uses the same possibly-dead DB; its rejection replaces the original error before it's logged or rethrown, and the run row sticks in `'running'`. Wrap the status update in its own try/catch. (H)
- [correctness] services/llm-enricher/src/index.ts:84-89 — 4h cron with no overlap guard: a slow backfill overlaps the next tick, which re-selects the same `isNull(llm_category)` rows → duplicate broker load and double RunPod spend. Use croner's `protect: true`. (H)

**Process hygiene**

- [architecture] all long-lived services — no SIGTERM/SIGINT handlers anywhere: `docker compose down` abandons `runs` rows in `'running'` status forever, poisoning `get_adapter_health`. Add graceful shutdown (close pool/server, mark in-flight run failed). (H; Node best practices)
- [architecture] packages/db/src/client.ts:6 — module-level pool creation + secret-file I/O at import time; any importer (including anything that only wants schema types) instantiates a live pool that is never `end()`ed. Expose lazy `getDb()` or a `/schema` subpath export. (H; Node best practices)
- [security] packages/db/src/build-url.ts:4-13 — bare `catch {}` swallows all secret-read errors (permission denied, mount misconfig) and silently falls back to the passwordless URL; also `process.env.DATABASE_URL!` fails deep in `new URL(undefined)` with a cryptic error when unset. Fall back only on `ENOENT`, warn on fallback, throw a named error for missing env. (H)
- [architecture] alerting is inconsistent: betterment wraps its run in ntfy, the enricher alerts in its cron catch, plaid-tap never alerts at all — and its compose block omits `NTFY_URL`/`NTFY_TOPIC` so it would silently no-op anyway. A broken bank feed goes unnoticed until someone queries staleness. Move alert-on-failure into `withRunRecord` (which already owns the failure path) and add the env vars. (H)

**Dead code & drift**

- [architecture/dry] services/fungible-tap/ — dead service (replaced per commit 9d3447b, absent from Makefile and compose) that still compiles and writes `source='plaid'` rows into the same id namespace; its copy-pasted upsert has **already diverged** (omits `amount` from the conflict-set), so an accidental run silently overwrites plaid-tap data with stale amounts. Delete it. (H)
- [dry] packages/adapter-utils/src/browser.ts — stale leftover of commit 265ae5f ("move browser.ts into each scraper service"): byte-identical to the 3 per-service copies, not exported, and imports `playwright` which isn't in adapter-utils' package.json (resolves only via workspace hoisting — phantom dependency). Delete. (H)
- [dry/api-dx] `--run-now` behaves differently in taps vs adapters: plaid-tap/fungible-tap register the cron first and never exit, so "one-shot" runs leave a daemon armed; the 3 adapters exit(0) correctly. Extract a shared CLI entrypoint helper so the flag semantics can't drift. (H)
- [dry] the 3 adapter index.ts files are ~85-line near-clones and the duplication has already produced two real divergences (the exit-ordering above; betterment's unused `writeFileSync` import). A shared `runAdapter({source, sessionPath, urlPattern, scrapeFn, cronExpr})` factory in adapter-utils is warranted at 3 copies with proven drift; keep scrape.ts/browser.ts per-service (that split was deliberate). (M)

**MCP server surface**

- [api-dx] services/mcp-server/src/tools/get-financial-snapshot.ts:7-18 — nests each sub-tool's full MCP envelope inside its own JSON, so the client must `JSON.parse` twice (outer text, then each field's `.content[0].text`). Refactor tools into plain data-returning functions with a thin MCP wrapper; snapshot composes the data functions. (H)
- [correctness/api-dx] services/mcp-server/src/tools/get-goal-progress.ts:26-27 — `stale` computed from `goals[0]` only, which is the *alphabetically first* account (`ORDER BY account_id`), not the freshest; one boolean misrepresents multi-goal freshness in both directions. Per-goal `stale` field or max-age across goals. (H; found independently by two agents)
- [api-dx] services/mcp-server/src/tools/get-adapter-health.ts:5 — hardcoded `SOURCES` list is a fourth place to remember when adding an adapter; a new adapter silently won't appear in health. Derive from `SELECT DISTINCT source FROM runs` or one shared list. (H)
- [architecture/security] services/mcp-server/src/index.ts:4 — HTTP+SSE transport deprecated since MCP spec 2025-03-26; ecosystem compatibility windows close through mid-2026, and Streamable HTTP is also where the maintained auth guidance lives — migrating naturally slots in the fix for MUST #7. SDK 1.29.0 already ships `StreamableHTTPServerTransport`. (H; three agents converged on this)
- [architecture/api-dx] services/mcp-server/src/config.ts:27-33 — `/config/pipeline.config.toml` hardcoded (untestable outside the container; use `CONFIG_PATH` env with that default); the forever-cache means config edits need a container restart, which no doc mentions; and a missing file surfaces as raw ENOENT with no setup pointer (contrast browser.ts's exemplary error). (H)

**Performance (calibrated to single-user scale)**

- [performance] packages/db/src/schema.ts — no index beyond the PK on `transactions`: the enricher's `isNull(llm_category)` scan and the materializer's `pending=false` scan run unindexed on the only ever-growing table, several times a day. Cheap partial indexes (`WHERE llm_category IS NULL`; on `pending`) end it permanently. Fine today; linear-forever growth. (H)
- [performance] services/llm-enricher/src/index.ts:54-59 — enriched rows written back one sequential `UPDATE` per row; negligible on cron runs, but `--backfill` turns it into thousands of round-trips after an already-slow LLM pass. Batch with `UPDATE ... FROM (VALUES ...)`. (H)

**Tests**

- [tests] packages/adapter-utils/src/with-run-record.test.ts:52 — asserts call counts against a mock that just invokes the callback; it cannot detect the one invariant that matters (NOTIFY inside the transaction, load-bearing for ADR 0014). Assert call order within the tx object, or add one testcontainers-based integration test. (H)
- [tests] services/mcp-server/src/tools/ — zero tests on the user-facing surface; the staleness/mapping logic in get-adapter-health and get-goal-progress is pure enough to test today with canned rows (never-run / stale / fresh / mixed windows). (H)
- [tests] services/plaid-tap/src/index.ts:68-79 — the Plaid→row mapping (category fallback chain, amount formatting) is a pure function inlined anonymously in `run()`; extract `mapPlaidTransaction()` and test fallback precedence + pagination (mock two `has_more` pages). Same for `parseDollar` + slug mapping in scrape.ts (unexported; its `|| 0` fallback is exactly what SHOULD-cluster "Data correctness" items exploit). (H/M)

## NIT (style / preference)

- services/materializer/src/journal.ts:18 — warn says `OLLAMA_BROKER_URL` but checks `JOURNAL_BROKER_URL`; misleading ops signal (two agents). Fix the string.
- services/mcp-server/src/index.ts:20 — the `as any` is justified for TS2589 but blankets all 7 `server.tool()` registrations, erasing schema/handler type-checking; narrow the cast. Related: `as Array<{...}>` casts on `db.execute` results lack the justification comment Google TS style asks for.
- get-monthly-spending.ts:6 — `year` unbounded (`year=99999` validates, returns `[]`, indistinguishable from "no data"); bound it `.int().min(2000).max(2100)`.
- get-net-worth.ts:22-26 — sums `parseFloat(balance)` currency-blind; harmless while everything is USD, latent corruption if a non-USD account ever appears. Assert uniform currency.
- .env.example — add one line stating L3 sends transaction descriptions/amounts to RunPod (third-party cloud); it's correctly default-off but the egress tradeoff is undocumented.
- ntfy alerts interpolate raw `${err}` over plain HTTP (compose-network-only today); send error class only, details stay in Loki.
- Float money: `parseFloat` + accumulate is provably sub-cent at this corpus size (~10⁴ txs), so not a live defect — but prefer SQL `SUM` on numeric or integer cents as data grows.
- Journal for a finished month is frozen at its last intra-month regeneration; late-posting transactions never appear. Consider one prior-month regeneration early each month.
- Naming/structure polish: snake_case leaking into TS-only locals (`by_cat`, `by_source`); `TxToEnrich`/`EnrichedTx` asymmetry; L1/L2/L3 build+fetch+parse boilerplate could share a `callBroker()` (~40 lines); `maybeGenerateJournal` is ~80 lines doing 5 jobs; `isStale` in compute.ts is dead in prod (only its test calls it) while both MCP tools reimplement the formula inline — one shared helper, three call sites.
- betterment index.ts:3 — unused `writeFileSync` import.
- Makefile — placeholder `YOUR_NAS_IP` defaults deserve a fail-fast guard or an override example comment.
- schema.ts:16 — `transactions.id` PK is the raw Plaid id with `source` as a separate column; a future non-Plaid source collides in the namespace (fungible-tap already squatted on `source='plaid'`). One-way door worth deciding while the table is small.
- MCP tool descriptions never state response shape/units (stringified USD decimals, snake_case fields); one-line hints help the LLM consumer.
- docker-compose.yml — grafana:11.0.0 / loki:3.0.0 pins are >2 years stale (Grafana 11.0.0 predates the 11.0.x advisory fixes, e.g. CVE-2024-9264 fixed in 11.0.5) and Grafana is host-exposed; bump pins. *(Borderline SHOULD; listed here only because Grafana is LAN-exposed, not internet-exposed.)*

## Standards this was measured against

- [Google eng-practices — What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — the review dimensions and the code-health-over-perfection frame (fetched live 2026-07-02).
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) — unknown over any, justified assertions, named exports, narrow nullables at source.
- MCP transport status: [auth0.com/blog/mcp-streamable-http](https://auth0.com/blog/mcp-streamable-http), [blog.fka.dev — Why MCP deprecated SSE](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/), plus deprecation notices (Atlassian cutoff 2026-06-30, Keboola 2026-04-01) — HTTP+SSE deprecated since spec rev 2025-03-26.
- Money handling: [honeybadger.io — Currency calculations in JavaScript](https://www.honeybadger.io/blog/currency-money-calculations-in-javascript/) — never IEEE754 floats for money; integer cents or decimal-string end-to-end.
- [goldbergyoni/nodebestpractices](https://github.com/goldbergyoni/nodebestpractices) (July 2026 revision) — no module-level side effects, graceful shutdown, no floating promises.
- LISTEN/NOTIFY reliability: [thinhdanggroup — Postgres as a message bus](https://thinhdanggroup.github.io/postgres-as-a-message-bus/), [npiontko.pro — Transactional outbox](https://www.npiontko.pro/2025/05/19/outbox-pattern) — NOTIFY is non-durable; outbox + drain + periodic sweep; the 2025 Recall.ai lock-contention incident (fixed only in PG19).

## Rejected / out of scope

- **Merchant-name → journal prompt-injection chain**: disproved by code trace — journal prompt receives only numeric aggregates and vocabulary-clamped category keys; raw description text never reaches it.
- **drizzle `date` column returns Date objects** (would break `tx.date + 'T00:00:00Z'`): verified drizzle 0.38.4 defaults date columns to string mode. Not a bug.
- **`db.execute()` needs `.rows`**: verified postgres-js driver returns a RowList array; the casts are shape-correct.
- **`cursors[accessToken] = cursor!` can be undefined**: `while (hasMore)` starts true, so `next_cursor` is always assigned at least once. The *storage location* of the cursor is the finding (MUST #5), not the assertion.
- **`withRunRecord` `.returning()` empty-array destructure**: insert failure throws before the destructure.
- **materializer full-table re-aggregation as a SHOULD**: fine for years at ~200 tx/month; kept only as an unranked note (watermark by affected months if history grows to 10⁵ rows).
- **Per-service cron scheduling and Postgres choice**: deliberate, documented (ADR 0008, ADR 0005).
- **`monthly_spending.total` = sum of all settled amounts**: matches CONTEXT.md's documented definition — only the "spending" *labeling* mismatch was kept (SHOULD).
- **SSE transports Map socket-error leak**: cleanup on `close` is wired; error-path lingering is theoretical at one client, a handful of sessions/day.

---
*Review: 8 parallel challenger agents (3× Fable — architecture, correctness, security; 5× Sonnet), findings triaged and deduped by the orchestrator. Report-only: no source files were modified.*
