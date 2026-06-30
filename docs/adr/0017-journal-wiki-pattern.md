# ADR 0017 — LLM financial journal (Karpathy wiki pattern)

**Status:** Accepted

**Context:** Raw numbers (net worth, monthly spending) are queryable but don't accumulate narrative context. Karpathy's LLM wiki pattern — letting an LLM maintain a living markdown document — provides compounding financial context across months.

**Decision:** After each materialization pass, the materializer checks whether the current month's journal entry needs updating (regenerate at most once per 24h). It fetches current net worth, spending, and goal progress, then calls the Ollama broker (interactive port 11435) to generate a 3–5 sentence first-person narrative. The entry is upserted to `journal_entries(month_key)`.

The `read_financial_journal` MCP tool exposes the last N months of entries. Claude can call this tool to get narrative financial context before answering questions about spending or net worth.

**Model:** Configurable via `JOURNAL_MODEL` env (default: `llama3.2`). Journal generation uses the interactive broker port (not batch) since it's a richer single-request generation.

**Consequences:** Journal entries are overwritten if the materializer runs multiple times in a day (after the 24h TTL expires). Month boundaries create new entries. Historical entries are preserved indefinitely.
