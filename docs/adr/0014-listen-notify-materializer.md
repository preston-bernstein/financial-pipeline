# ADR 0014 — LISTEN/NOTIFY for materializer trigger

**Status:** Accepted

**Context:** After each adapter run, spending aggregates need to be recomputed. Options: poll the DB on a timer, call materializer directly, or use Postgres LISTEN/NOTIFY.

**Decision:** Each adapter (via `withRunRecord`) inserts a `pending_materialization` row and fires `pg_notify('materialization_requested', source)` inside the same transaction. The materializer runs a persistent `postgres.listen()` connection and recomputes on NOTIFY.

Why inside the transaction: the NOTIFY only fires on commit, so the materializer can't see partial data from a failed adapter run.

**Consequences:** The `pending_materialization` table acts as an audit trail and dedup guard (materializer claims rows before computing). The materializer must be running for notifications to arrive — on cold start, it processes any unprocessed `pending_materialization` rows.

TODO: add cold-start drain pass to materializer (process any unprocessed rows on startup).
