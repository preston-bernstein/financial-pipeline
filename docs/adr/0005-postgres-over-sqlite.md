# ADR 0005 — PostgreSQL over SQLite

**Status:** Accepted

**Context:** Financial pipeline needs a database that supports LISTEN/NOTIFY for the materializer trigger pattern, concurrent writes from multiple adapter services, and DISTINCT ON queries for latest-per-account reads.

**Decision:** PostgreSQL (Docker, NAS). SQLite doesn't support LISTEN/NOTIFY or concurrent multi-writer workloads.

**Consequences:** Requires a running Postgres container. Local dev needs `DATABASE_URL` pointed at a Postgres instance (or Docker Compose up). The `packages/db/Dockerfile` runs migrations on startup.
