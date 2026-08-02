# Requirements: Docker Compose Restart Policy

## Problem statement

`docker-compose.yml` declares no `restart` policy on any of its 12 services. On 2026-07-21 the deploy host rebooted; all containers that were running exited with status `Exited(255)` and none came back, because Docker was never told to restart them. The outage lasted 11 days and produced zero alerts, since every alerting path (Grafana, ntfy, the `mcp-server` `/metrics` endpoint) runs as a container in the same compose file and was itself down. The person affected is Preston, the sole operator, who depends on this pipeline for transaction ingestion, balance snapshots, and the monthly journal — all of which silently stopped accumulating data for 11 days. This is a known, previously-triggered failure mode, not a hypothetical: the fix must close the exact gap that caused the 2026-07-21 outage.

## Users / stakeholders

- Preston — sole operator and on-call for this repo; the person who has to notice and fix outages.
- The deploy host (NAS, per README `Deploy` row) — restarts on reboot, firmware update, or power loss; Docker's restart policy is what determines whether services recover unattended.
- Downstream data consumers — `mcp-server` MCP tools (`get_monthly_spending`, `get_net_worth`, `get_adapter_health`, etc.) and the Grafana/ntfy alerting path, all of which depend on their upstream services being up to have anything to report.

## Functional requirements

1. The system shall set `restart: unless-stopped` on every service in `docker-compose.yml` except `migrate`.
2. The system shall leave `migrate`'s existing `restart: "no"` unchanged, so a one-shot migration job that exits 0 stays stopped and is never restarted by Docker.
3. The system shall apply the restart policy identically across all affected services — no service-specific restart policy (e.g., `on-failure`, `always`) unless a service is later shown to need one; this change enforces one policy value (`unless-stopped`) uniformly, mirroring the pattern in home-infra's scraper-egress compose.
4. The system shall preserve every other existing field on every service (`image`, `build`, `environment`, `volumes`, `secrets`, `depends_on`, `healthcheck`, `ports`, `command`) exactly as currently written — this change adds one key per service and changes nothing else.
5. The system shall result in a `docker-compose.yml` that passes `docker compose config` (or equivalent config validation) with no syntax errors after the change.
6. The system shall result in, after `make deploy` and a host reboot (or `docker kill` of a running container followed by a wait), every non-`migrate` service returning to a `running` state without manual intervention, and `migrate` remaining `Exited (0)` and not restarted.
7. The system shall verify that the deploy host's Docker daemon is enabled to start automatically on host boot (e.g., `systemctl is-enabled docker` returns `enabled`) — without this, no `restart:` policy in the compose file has any effect after a real host reboot.

## Non-functional requirements

- No performance targets apply — this is a static config change with no runtime behavior beyond Docker's own restart scheduling.
- No new secrets, ports, or network exposure are introduced.
- Change-control gate applies per repo convention (per feature description: "this is a change-control-gated infra change") — the change must go through whatever review/approval step the repo's change-control process requires before deploy, not be pushed straight to the host.

## Constraints

- Must integrate with the existing `docker-compose.yml` structure. The deploy mechanism (Makefile `push` target) must be extended with a step that syncs `docker-compose.yml` (and `.env.example`) to the deploy host before `docker compose up -d` runs, mirroring the rsync-before-up pattern already used in home-infra's scraper-egress `deploy.sh` — the current flow (build → `ssh docker load` → `ssh ... docker compose up -d`) never transfers `docker-compose.yml` to the deploy host, so without this step the restart-policy edit could never reach production (verified live on the deploy host, desktop, user `finpipe`, path `/opt/docker/financial-pipeline`: the compose file there is a manually-synced static file, not touched by `make deploy`). No other Makefile behavior changes — build/push image logic stays the same; only the missing compose-file sync step is added.
- Must mirror the restart-policy pattern already established in home-infra's scraper-egress compose (i.e., use the same policy value, `unless-stopped`, not a different one invented for this repo).
- `migrate` is a one-shot DB migration job that must exit 0 and stay stopped; it is the one deliberate exception to "every service" and must not receive `restart: unless-stopped` or any restart policy that would cause Docker to re-run it.
- No new services, volumes, secrets, images, or dependencies may be introduced by this change.

## Out of scope

- Any alerting, monitoring, or health-check additions (e.g., detecting that a container is down and paging someone) — this change only makes containers self-recover on the host; it does not add visibility into whether they're up.
- Retrying or backoff tuning (e.g., `restart: on-failure:N`, custom restart delays) — `unless-stopped` is the only policy value in scope.
- Changes to `migrate`'s restart behavior, image, or migration logic.
- Any change to service definitions beyond the `restart` key (env vars, healthchecks, resource limits, image versions, etc.).
- Retroactive recovery or backfill of data lost during the 2026-07-21 outage.
- Host-level reboot handling outside Docker (e.g., systemd unit ordering, Docker daemon start-on-boot) — this change assumes the Docker daemon itself comes back after a host reboot; it only ensures containers rejoin once it does.

## Acceptance criteria

1. `docker-compose.yml` contains `restart: unless-stopped` under exactly 11 of the 12 top-level services: `postgres`, `plaid-tap`, `betterment-adapter`, `vanguard-adapter`, `fidelity-adapter`, `materializer`, `llm-enricher`, `mcp-server`, `loki`, `grafana`, `ntfy`.
2. `docker-compose.yml`'s `migrate` service retains `restart: "no"` unchanged and has no `unless-stopped` policy applied.
3. `docker compose config` (run against the modified file) exits 0 with no errors.
4. A diff of the change shows only `restart:` lines added (one per affected service) — no other line in `docker-compose.yml` is modified, reordered, or removed.
5. After deploying the change and restarting the Docker daemon (e.g., `systemctl restart docker` or equivalent) — the authoritative validation method, since this is what actually exercises the 2026-07-21 failure mode of all containers restarting concurrently with no `depends_on` ordering (`depends_on` conditions are evaluated only by the `docker compose up` CLI, not by the daemon's native restart-policy recovery) — every one of the 11 affected services reaches `Up`/`running` state within Docker's standard container startup time for that image, with no artificial delay imposed by the restart policy itself on the first restart, and with no manual `docker compose up` invocation. `docker kill` on a running container is acceptable as a quick smoke check only, not the acceptance-bar test.
6. After the same daemon-restart test, `migrate` remains in `Exited (0)` state and Docker does not attempt to restart it.
7. On the deploy host, `systemctl is-enabled docker` (or equivalent) returns `enabled`, confirming the Docker daemon starts automatically on host boot.
