# Tasks: Docker Compose Restart Policy

Generated from: docs/docker-restart-policy/ on 2026-08-02

## Status legend
- [ ] pending
- [>] in progress
- [x] done
- [!] blocked

## Tasks

### Task 1: Add `restart: unless-stopped` to docker-compose.yml for all non-migrate services
**Status**: [x] done
**Files**: docker-compose.yml
**Test**: Diff shows exactly 11 lines added, zero other lines modified, migrate's `restart: "no"` unchanged.
**Depends on**: none
**Parallelizable**: No
**Notes**: Verified via git diff — 11 insertions, 0 deletions, migrate untouched. `docker compose config` (with real .env) confirms 11 `unless-stopped` + 1 `"no"` = 12 total, exit 0.

### Task 2: Validate docker-compose.yml syntax and restart policy placement
**Status**: [x] done
**Files**: (no changes — verification only)
**Test**: `docker compose config` exits 0; 11 `unless-stopped` + 1 `"no"` = 12 restart lines.
**Depends on**: Task 1
**Parallelizable**: No
**Notes**: Confirmed exit 0 with real .env copied in temporarily (worktree doesn't carry the gitignored .env); count matches exactly (11 + 1).

### Task 3: Fix `make deploy` to sync docker-compose.yml to the deploy host
**Status**: [x] done
**Files**: Makefile
**Test**: Edited `push` target contains an rsync of docker-compose.yml + .env.example to `$(NAS_USER)@$(NAS_HOST):$(NAS_PATH)/`, before the docker load line.
**Depends on**: none
**Parallelizable**: Yes (independent of Task 1; different file)
**Notes**: Added `rsync -az docker-compose.yml .env.example $(NAS_USER)@$(NAS_HOST):$(NAS_PATH)/` before the docker load line, mirroring home-infra scraper-egress deploy.sh's rsync style. Diff scoped to exactly 2 new lines.

### Task 4: Commit changes and open a PR for review
**Status**: [ ] pending
**Files**: docker-compose.yml, Makefile (committed, not further modified)
**Test**: Commit contains both files; PR opened against default branch.
**Depends on**: Task 2, Task 3
**Parallelizable**: No
**Notes**: Orchestrator-run — folds into this ship-it run's Phase 6 (commit + merge), not a spawned implementation agent.

### Task 5: Deploy the restart policy change via make deploy
**Status**: [ ] pending
**Files**: (no changes)
**Test**: `make deploy` exits 0; host's docker-compose.yml updated (diff/mtime check confirms Task 3's rsync fix works).
**Depends on**: Task 4
**Parallelizable**: No
**Notes**: Orchestrator-run — folds into this ship-it run's Phase 7 (deploy).

### Task 6: Simulate host reboot by restarting the Docker daemon
**Status**: [ ] pending
**Files**: (no changes)
**Test**: `sudo systemctl restart docker` on the deploy host; daemon comes back active.
**Depends on**: Task 5
**Parallelizable**: No
**Notes**: NOT auto-executed. `systemctl restart docker` on the desktop host restarts every container on that host (arr-stack, algo-factory, scraper-egress, observability — not just financial-pipeline's 12 services) — a shared-infrastructure, hard-to-reverse-adjacent action beyond this task's blast radius, and steps.md itself calls for the operator to be present. Deferred to Preston as a recommended manual follow-up; this ship-it run's Phase 8 verifies the deploy landed correctly without forcing a full daemon restart.

### Task 7: Verify post-restart state — 11 services recovered, migrate stayed Exited(0)
**Status**: [ ] pending
**Files**: (no changes)
**Test**: `docker compose ps` shows 11 services Up, migrate Exited(0).
**Depends on**: Task 6
**Parallelizable**: No
**Notes**: Depends on Task 6, which is deferred — this task is deferred with it (see Task 6 Notes).

### Task 8: Verify manual stop is respected across a daemon restart
**Status**: [ ] pending
**Files**: (no changes)
**Test**: `docker compose stop ntfy`, restart daemon, confirm ntfy stays stopped while others recover.
**Depends on**: Task 7
**Parallelizable**: No
**Notes**: Depends on Task 6/7, which are deferred — this task is deferred with them (see Task 6 Notes).

## Blocked / open
(populated during implementation)
