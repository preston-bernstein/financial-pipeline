# ADR 0008 — Adapter run schedule

**Status:** Accepted

**Context:** Adapters need to run frequently enough to keep data fresh but not so frequently as to risk rate-limiting or triggering fraud detection.

**Decision:**

| Adapter | Schedule | Rationale |
|---|---|---|
| plaid-tap | Every 4h (`0 */4 * * *`) | Plaid sync is API-based, low-risk, transactions update throughout the day |
| llm-enricher | Every 4h +30min (`30 */4 * * *`) | Offset from plaid-tap so enrichment runs after new transactions land |
| betterment-adapter | Daily 8pm (`0 20 * * *`) | Market data updates once daily; evening gives full trading-day data |
| vanguard-adapter | Daily 7pm (`0 19 * * *`) | Same rationale; slightly earlier to spread browser sessions |
| fidelity-adapter | Daily 7pm (`0 19 * * *`) | Same |

**Consequences:** Staleness windows in `pipeline.config.toml` [staleness] section reflect these schedules with some buffer. `get_adapter_health` uses these windows to flag stale data.
