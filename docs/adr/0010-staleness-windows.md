# ADR 0010 — Staleness windows

**Status:** Accepted

**Context:** Financial data has a time-to-stale based on adapter schedule. MCP tools need to surface whether data is fresh enough to trust.

**Decision:** Staleness windows are defined in `pipeline.config.toml [staleness]`:
- `plaid_hours = 8` — 2× the 4h run interval
- `betterment_hours = 48` — 2× the 24h run interval
- `vanguard_hours = 48`
- `fidelity_hours = 48`

The `get_adapter_health` and `get_goal_progress` MCP tools read these windows and return a `stale: bool` field. A stale flag means the adapter hasn't succeeded within the expected window — likely a session expiry or network issue.

**Consequences:** When `stale: true` appears in MCP tool output, Preston should check `get_adapter_health` for the error_message and re-seed the session if needed.
