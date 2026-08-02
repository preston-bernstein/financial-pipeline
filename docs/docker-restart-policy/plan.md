# Plan: Docker Compose Restart Policy

## Approach

Add `restart: unless-stopped` as a new top-level key under each of the 11 non-`migrate` services in `docker-compose.yml`, leaving every other line untouched. `unless-stopped` is the correct policy because it recovers containers after a host reboot or crash (the 2026-07-21 failure mode) while still respecting an operator's explicit `docker compose stop`, and it's the exact value already proven in home-infra's scraper-egress compose — no new policy vocabulary is introduced. `migrate` keeps its existing `restart: "no"` untouched since it's a one-shot job that must not be re-run by Docker after exiting 0. This is a pure additive YAML edit with no logic, script, or dependency changes.

## Architecture

No architectural change. This only affects how the Docker daemon supervises already-defined containers after they exit; it does not change which services exist, how they connect, `depends_on` ordering, or data flow between them.

```
Host reboot / daemon restart
        │
        ▼
Docker daemon reads docker-compose.yml restart policies
        │
        ├─ postgres, plaid-tap, betterment-adapter, vanguard-adapter,
        │  fidelity-adapter, materializer, llm-enricher, mcp-server,
        │  loki, grafana, ntfy   → restart: unless-stopped → come back Up
        │
        └─ migrate                → restart: "no"           → stays Exited(0)
```

## Data model

No data model changes.

## API / interface contract

None.

## Integration points

- `docker-compose.yml` — add `restart: unless-stopped` as a new line under each of: `postgres`, `plaid-tap`, `betterment-adapter`, `vanguard-adapter`, `fidelity-adapter`, `materializer`, `llm-enricher`, `mcp-server`, `loki`, `grafana`, `ntfy`. Placed at the same indentation level as each service's other top-level keys (e.g., `image`, `healthcheck`, `depends_on`), consistent with the placement convention in home-infra's `compose/desktop/scraper-egress/docker-compose.yml`. No other line in the file changes; `migrate`'s existing `restart: "no"` at line ~32 is left as-is.
- `Makefile` — the `push` target (lines ~20-23) only `docker save`s images over SSH and never transfers `docker-compose.yml`; verified live on the deploy host (desktop, `finpipe` user, `/opt/docker/financial-pipeline`) that the compose file there is a manually-synced static copy `make deploy` never touches. Without a sync step, the new `restart:` lines can be committed and pushed forever without ever reaching production. Add an rsync step in `push`, before the `docker save | ssh ... load` line, that copies `docker-compose.yml` and `.env.example` to `$(NAS_USER)@$(NAS_HOST):$(NAS_PATH)/`, mirroring the `rsync -az` pattern in home-infra's `compose/desktop/scraper-egress/deploy.sh`.

## Technology choices

No new libraries or patterns. `restart: unless-stopped` is native Docker Compose syntax already in use elsewhere in the fleet (home-infra scraper-egress); this change only extends that existing convention to this repo.

## Risk areas

- **Placement drift across 11 edits** — each `restart:` line must land under the correct service block and not accidentally get added under `migrate` or duplicated; mitigate by diffing after the edit to confirm exactly 11 additions and zero other changed lines (per acceptance criterion 4).
- **YAML validity** — a misindented key silently nests under the wrong service or breaks parsing; `docker compose config` must be run after the edit to confirm exit 0 (acceptance criterion 3), not just a visual check.
- **`depends_on` ordering is not enforced on daemon-native restart** — `depends_on: service_completed_successfully` (and `service_healthy`) is a `docker compose up` CLI-time behavior only. The Docker daemon's own restart-policy recovery — what actually fires after a host/daemon reboot — never consults `depends_on` at all. So a real reboot restarts all 11 `unless-stopped` containers concurrently, with no ordering and no health gating: all 10 dependent services come up at the same instant as `postgres`, not staggered behind it. This is the real boot-time behavior for this change, not a narrow `migrate`-specific edge case. The services likely tolerate it — checked `packages/db/src/client.ts` and the adapters' scheduler pattern, both of which connect to Postgres lazily per-tick with retry rather than requiring a connection at startup — but that tolerance is untested. Acceptance validation should do an actual daemon restart (`sudo systemctl restart docker` or a host reboot), not a single-container kill, since a single-container kill can't exercise the concurrent, unordered boot race.
- **No healthchecks on 9 of 11 services (deferred)** — only `postgres` and `loki` define a `healthcheck`. `restart: unless-stopped` only fires on container *exit*; it does nothing for a process that's alive but wedged, e.g., a hung Playwright `page.goto()` in one of the three investment adapters during a real login flow — a realistic failure mode for browser automation. This fix recovers from crashes/exits, not hangs. Out of scope for this change per its stated boundaries (no changes to service definitions beyond `restart`); flagged here as a known gap for a future, separate change, not fixed now.
- **Orphaned `status='running'` run records on hard kill (deferred)** — `packages/adapter-utils/src/with-run-record.ts` inserts a `status='running'` row at the start of every adapter/tap run and only closes it to `success`/`failure` on normal return or thrown exception. No service registers a `SIGTERM`/`SIGINT` handler, and no `stop_grace_period` is set, so Docker's default 10s SIGTERM-then-SIGKILL applies on every restart. A reboot or redeploy that catches an adapter mid-scrape hard-kills it and leaves a permanently orphaned `running` row that `get_adapter_health`'s staleness logic (per CONTEXT.md) has no way to reconcile — an untested third state that could mask the true last-known-good run. This is a real correctness gap adjacent to this fix's goal (protecting observability), but fixing it means adding SIGTERM handlers or a startup reconciliation pass across all six service entrypoints — out of scope for this compose-only, change-control-gated edit. Flagged here for a future, separate change.
- **Daemon-start-on-boot is an unverified prerequisite** — this entire fix assumes the deploy host's Docker daemon itself is configured to start automatically on boot. No `restart:` value in `docker-compose.yml` does anything if `dockerd` never comes back after a reboot. Verify with `systemctl is-enabled docker` on the deploy host before relying on this change for reboot recovery.
- **Change-control gate** — per requirements' non-functional constraint, this must go through the repo's normal review/approval step before deploy; the plan itself doesn't need to build that gate, just not bypass it.
