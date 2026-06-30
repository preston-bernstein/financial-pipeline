# ADR 0016 — LLM enrichment stamping

**Status:** Accepted

**Context:** The LLM enricher classifies transactions using a specific model and prompt. As models and prompts evolve, it must be possible to identify which transactions were classified under which version, and to re-classify when the prompt changes.

**Decision:** Every enriched transaction row is stamped with:
- `llm_category` — the output category (closed vocab)
- `llm_model` — the Ollama model name used (e.g., `llama3.2:3b`)
- `prompt_version` — a human-readable version string defined in `enrich.ts` (e.g., `enrich-v1`)

**Backfill:** `docker compose run --rm llm-enricher node dist/index.js --backfill` resets all three fields to NULL and re-runs classification. This is how to migrate when the prompt or model changes.

**Consequences:** Frozen at enrichment time — changing the model doesn't retroactively re-classify. Explicit backfill required. This is intentional: it mirrors the estate-scraper ADR 0016 pattern for VLM stamping, and allows controlled corpus evolution.
