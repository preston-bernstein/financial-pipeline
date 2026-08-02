# Spec Challenge Notes

## Agents run
- Requirements Auditor (haiku): 1 issue found, 1 accepted
- Scope & Dependency Auditor (sonnet): 4 issues found, 3 accepted (1 folded into accepted set below as a duplicate of the deploy-sync finding)
- Design Devil's Advocate (sonnet): 4 issues found, 3 accepted (2 refuted by source-reading, not counted as findings)
- Implementation Realist (sonnet): 5 issues found, 4 accepted
- Steps & Sequencing Critic (sonnet): 7 issues found, 7 accepted
- Data Model Critic (sonnet): 0 issues found (confirmed no data model in scope; 1 process observation folded into the depends_on risk area)
- Security/Threat Auditor (haiku): 0 issues found (clean pass — no auth, input, injection, exposure, dependency, or secrets surface in a compose restart-policy edit)

## Changes made
- **Corrected a false constraint**: requirements.md said "no changes to the Makefile" — verified live on the deploy host (desktop, `finpipe` user, `/opt/docker/financial-pipeline`) that `make deploy` never actually syncs `docker-compose.yml` there; the host's copy is a manually-maintained static file. Without fixing this, the restart-policy edit could never reach production. Constraint rewritten to require a minimal `rsync` fix to the Makefile's `push` target, mirroring home-infra's scraper-egress `deploy.sh`.
- **Fixed the reboot-simulation test to match the real failure mode**: the original steps used `docker kill $(docker ps -q)`, which SIGKILLs everything and never exercises the actual mechanism — a Docker daemon restart, where `depends_on` ordering isn't enforced at all (that's a `docker compose up` CLI-only behavior). Steps now use `sudo systemctl restart docker` as the authoritative test, with `docker kill` demoted to an optional smoke check.
- **Added the missing change-control step**: requirements already mandated a review gate before deploy, but no step referenced it. Added a commit + PR step before deploy, matching this repo's actual merge convention.
- **Documented two real but out-of-scope operational risks instead of silently expanding scope**: (1) 9 of 11 services have no healthcheck, so this fix recovers from crashes/exits but not hangs; (2) adapters have no SIGTERM handler, so a hard-killed mid-scrape run leaves an orphaned `status='running'` row with no reconciliation. Both are named in plan.md as deferred, not implemented — fixing either means touching service code, which the original instruction ("keep it to exactly this") explicitly excludes.
- **Merged redundant steps and fixed a mislabeled one**: old Step 3 claimed to use `docker compose ls`/`inspect` but its actual test just re-ran the same `docker compose config` check as Step 2 — merged. Old Steps 6/7 were both read-only checks with no dependency on each other — merged into one verification step.
- **Loosened an arbitrary timing bound**: "10-15s / 30s total" for service recovery was tighter than Postgres's own healthcheck budget (up to 50s) and didn't account for WAL crash-recovery after an ungraceful stop. Now polls every 5s up to 90s.
- **Added a test for the actual design rationale**: `unless-stopped` was chosen over `always` specifically because it respects `docker compose stop` — nothing tested that half. Added a lightweight step that stops one service, restarts the daemon, and confirms it stays stopped.

## Critiques rejected
- Two Design Devil's Advocate hypotheses (Playwright adapters crash-looping into repeated real logins; DB-unreachable crash-loop at container boot) were investigated against actual source (`packages/db/src/client.ts`, service entrypoints) and refuted — all six long-running services are cron-scheduled daemons with lazy DB connections and per-tick retry; restarting them just resumes a scheduler waiting for its next tick. Not applied.
- Adding healthchecks to the 3 investment adapters and adding SIGTERM handlers / startup reconciliation for orphaned run rows: both real gaps, but out of scope for a compose-only, change-control-gated restart-policy edit per the original instruction. Documented as deferred risks in plan.md instead of implemented.
- A dedicated step to "exercise" the rollback plan: the existing git-revert description is adequate for a two-file (docker-compose.yml, Makefile) tracked-file change; a rehearsal step would be ceremony disproportionate to the change.

## Open questions requiring human input
None — no hard blocker (security, data loss, or ADR contradiction) surfaced. The deploy-mechanism gap is a correctness fix within this task's scope, not a blocker requiring a stop.
