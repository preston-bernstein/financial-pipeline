# Steps: Docker Compose Restart Policy

## Prerequisites
Confirm the deploy host's Docker daemon is enabled to start on boot: `systemctl is-enabled docker` must return `enabled`. Without this, no restart policy has any effect after a real reboot — the daemon itself would never come back to apply it.

## Implementation steps

### Step 1: Add `restart: unless-stopped` to docker-compose.yml for all non-migrate services
**What**: Edit docker-compose.yml to inject `restart: unless-stopped` under each of the 11 affected services (postgres, plaid-tap, betterment-adapter, vanguard-adapter, fidelity-adapter, materializer, llm-enricher, mcp-server, loki, grafana, ntfy) at the same indentation level as existing top-level keys, leaving migrate untouched.
**Files**: docker-compose.yml
**Test**: Diff the file to confirm exactly 11 lines added (one per affected service), zero other lines modified, and migrate's `restart: "no"` unchanged. Visually verify each service block now contains `restart: unless-stopped` by viewing the modified services.
**Depends on**: none
**Parallelizable**: No

### Step 2: Validate docker-compose.yml syntax and restart policy placement
**What**: Run `docker compose config` against the modified file to confirm YAML validity, schema compliance, and that the restart policies land where expected.
**Files**: (no changes)
**Test**: `docker compose config` exits 0 with no errors, and output shows all 12 services defined without parse errors. Then run `docker compose config | grep -A 1 'restart:'` and confirm output shows `unless-stopped` under 11 services and `"no"` under migrate — 11 `unless-stopped` + 1 `"no"` = 12 total restart lines.
**Depends on**: Step 1
**Parallelizable**: No

### Step 3: Fix `make deploy` to sync docker-compose.yml to the deploy host
**What**: The deploy host's copy of docker-compose.yml at `/opt/docker/financial-pipeline` is a manually-maintained static file — `make deploy` never syncs it (verified live). Edit the Makefile's `push` target to add an `rsync` of `docker-compose.yml` and `.env.example` to `$(NAS_USER)@$(NAS_HOST):$(NAS_PATH)/` before the `docker load` line, mirroring the pattern in home-infra's scraper-egress `deploy.sh`.
**Files**: Makefile
**Test**: Read the edited `push` target (or run `make push --dry-run` if the Makefile supports it) and confirm the new rsync line targets `$(NAS_USER)@$(NAS_HOST):$(NAS_PATH)/` and runs before `docker load`. The real proof is Step 5 showing the host's compose file actually changed after deploy.
**Depends on**: none
**Parallelizable**: Yes (independent of Steps 1-2; touches a different file)

### Step 4: Commit changes and open a PR for review
**What**: This repo requires PRs for merges (per `git log` / `gh pr list` history). Commit the docker-compose.yml restart-policy change and the Makefile rsync fix together, push the branch, and open a PR describing both changes so they go through review before deploy — this is what the change-control NFR in requirements.md actually requires.
**Files**: docker-compose.yml, Makefile (committed, not further modified)
**Test**: `git log` shows a commit containing both files. `gh pr list` (or `gh pr view`) shows an open PR against the default branch referencing this change. PR is reviewed/approved and merged before proceeding to Step 5.
**Depends on**: Step 2, Step 3
**Parallelizable**: No

### Step 5: Deploy the restart policy change via make deploy
**What**: Push the modified docker-compose.yml (and Makefile-driven rsync) to the deploy host using the established deploy mechanism, now that the change has been merged.
**Files**: (no changes)
**Test**: `make deploy` exits 0. Verify on the deploy host that docker-compose.yml contains the new restart policies by running `docker compose config | grep -A 1 'restart:'` and confirming the output matches expectations (11 `unless-stopped`, 1 `"no"`). Confirm the host's docker-compose.yml file itself was updated (e.g. `diff` against the repo copy, or check mtime) — this is the proof that Step 3's rsync fix actually works.
**Depends on**: Step 4
**Parallelizable**: No

### Step 6: Simulate host reboot by restarting the Docker daemon
**What**: Restart the Docker daemon to simulate the host reboot scenario that triggered the 2026-07-21 outage. This is the faithful reproduction of a real reboot: it gracefully stops containers via SIGTERM first (not SIGKILL), and it exercises the concurrent, unordered container-restart race that `depends_on` conditions don't protect against at the daemon level — the actual mechanism behind the original outage. Run this step with the operator (Preston) present, since this is the sole financial pipeline for the household and a live production host is being restarted.
**Files**: (no changes)
**Test**: On the deploy host, run `sudo systemctl restart docker` (or the platform equivalent). Confirm the daemon comes back via `systemctl is-active docker` returning `active`. Optional quick smoke check only (not the acceptance-bar test): `docker kill $(docker ps -q)` can be used for a faster, lower-fidelity check of restart-policy wiring, but it does not substitute for the daemon-restart test above since it SIGKILLs instead of SIGTERM-stopping and doesn't reproduce the daemon-level race.
**Depends on**: Step 5
**Parallelizable**: No

### Step 7: Verify post-restart state — 11 services recovered, migrate stayed Exited(0)
**What**: Confirm both halves of the restart-policy contract in one pass: the 11 affected services auto-recover to running state, and `migrate` stays in `Exited(0)` without Docker attempting to restart it.
**Files**: (no changes)
**Test**: Poll `docker compose ps` every 5 seconds for up to 90 seconds total before declaring failure (looser than a fixed wait — Postgres's own healthcheck budget is `interval 5s × retries 10` = up to 50s, and SIGTERM-triggered WAL crash-recovery can be slower than a graceful stop). In the same `docker compose ps` output, confirm: (a) all 11 non-migrate services (postgres, plaid-tap, betterment-adapter, vanguard-adapter, fidelity-adapter, materializer, llm-enricher, mcp-server, loki, grafana, ntfy) show status `Up` or `running`; (b) `migrate` shows status `Exited(0)`. Run `docker compose logs migrate` and verify the final lines show the migration exiting with status 0 and no subsequent restart or re-run entries. Confirm exactly one `migrate` container entry exists.
**Depends on**: Step 6
**Parallelizable**: No

### Step 8: Verify manual stop is respected across a daemon restart
**What**: Confirm the reason `unless-stopped` was chosen over `always`: it must respect an operator's explicit `docker compose stop`. Stop one representative non-migrate service, trigger another daemon restart, and confirm that service stays stopped while the rest recover. A single service is enough — this isn't re-testing all 11.
**Files**: (no changes)
**Test**: Run `docker compose stop ntfy` and confirm it shows `Exited` via `docker compose ps`. Restart the Docker daemon again (`sudo systemctl restart docker`, same method as Step 6). After the daemon is back (`systemctl is-active docker` = `active`) and the poll window from Step 7 has elapsed, run `docker compose ps` and confirm `ntfy` is still `Exited` (did not restart), while the other 10 non-migrate services are `Up`/`running` and `migrate` is still `Exited(0)`. Clean up with `docker compose start ntfy` to restore normal state.
**Depends on**: Step 7
**Parallelizable**: No

## Rollback plan
All steps reversible via git — both docker-compose.yml and Makefile are tracked files. If syntax validation (Step 2) rejects the file, `git checkout docker-compose.yml` restores the original state. If the Makefile rsync edit (Step 3) is wrong, `git checkout Makefile` restores it. If the PR (Step 4) hasn't merged yet, close it and no further action is needed. If deployment (Step 5) succeeds but post-reboot tests (Steps 7-8) fail, revert via `git revert` on the merge commit (or `git checkout` both files) and re-run `make deploy` to restore the deploy host to its prior state.
