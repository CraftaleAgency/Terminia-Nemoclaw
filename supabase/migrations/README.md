# Supabase Migrations

This directory should contain versioned SQL migration files for the Terminia database schema.

## Current State
The database schema was created manually via Supabase Studio. Migration files need to be generated from the running database.

## How to Export
```bash
# From a machine with access to the Supabase Postgres:
pg_dump -h localhost -p 5432 -U postgres -d postgres --schema-only > supabase/migrations/001_initial_schema.sql

# Or use Supabase CLI:
supabase db dump --local > supabase/migrations/001_initial_schema.sql
```

## Naming Convention
- `001_initial_schema.sql` — Base tables, types, functions
- `002_rls_policies.sql` — Row Level Security policies
- `003_seed_data.sql` — Initial data (optional)

## Tables (documented in DATABASE_SCHEMA.md)
See `docs/DATABASE_SCHEMA.md` for the complete schema reference.
