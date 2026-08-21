# Database schema

PostgreSQL schema for the attendance system. Defines:

- `users` — students, teachers, admins (role enum, soft-active flag)
- `subjects` — courses, with department/semester
- `sessions` — a scheduled class meeting of a subject
- `attendance` — one row per (student, session), status + confidence
- `face_descriptors` — 128-d face-api.js descriptors, JSONB array

## Apply

```
psql -U postgres -d attendance -f db/schema.sql
```

Or from inside psql:

```
\i db/schema.sql
```

The script is idempotent: enums use `DO $$ ... duplicate_object $$`,
tables/indexes/triggers use `IF NOT EXISTS` / `DROP IF EXISTS`, and the
whole thing runs inside a single transaction.
