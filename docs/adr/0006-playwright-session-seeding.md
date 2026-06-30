# ADR 0006 — Playwright session seeding for investment adapters

**Status:** Accepted

**Context:** Betterment, Vanguard, and Fidelity don't expose official APIs. Browser automation is the only option. Each requires an authenticated session.

**Decision:** One-time manual login via `--seed-session` flag. The adapter launches a non-headless Chromium, the user logs in, and the browser saves `storageState` to a Docker volume. Subsequent runs restore the session from disk. When session expires, re-run `docker compose run --rm <adapter> node dist/index.js --seed-session`.

**Note:** Running `--seed-session` in Docker requires a display. On Linux: pass `DISPLAY=$DISPLAY` and mount `/tmp/.X11-unix`. On Mac: use XQuartz or run seed-session locally, then copy the storageState JSON to the NAS volume.

**Consequences:** Sessions expire (typically 30–90 days). The `get_adapter_health` MCP tool surfaces stale runs, which signals that session re-seeding is needed.
