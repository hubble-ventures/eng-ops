# pg-admin

A generic, read-only admin application that wraps any Postgres database.
Built with **TanStack Start** (file-based routing + server functions),
**TanStack Router**, and **TanStack Query**.

## What it does

It introspects the configured schema (`information_schema`) at startup and
generates the whole admin UI from your real tables and foreign keys:

- **Home page (`/`)** — card grid of every entity (table) in the schema.
  Click one to open its list view.
- **Entity list (`/entities/:table`)** — paginated, raw rows for that table.
  Foreign-key cells are rendered as links to the referenced row. Rows can be:
  - **sorted** by clicking a column header (asc → desc → off); defaults to
    ordering by the primary key for stable pagination,
  - **searched** with the free-text box (case-insensitive match across every
    column, cast to text),
  - **filtered** with the per-column builder (`=`, `≠`, contains, `>`, `≥`,
    `<`, `≤`, is null, is not null); active filters show as removable chips.
  All of this lives in the URL (`?sort`, `?dir`, `?q`, `?filters`), so a
  filtered view is shareable and survives reload.
  Cell values are rendered by type: timestamps/dates as compact readable
  values, booleans as pills, arrays as chips, and JSON/JSONB compacted in the
  grid but pretty-printed in the record view.
- **Entity overview (`/entities/:table/:pk`)** — one record, showing:
  - **Links**: pills for each outbound FK, linking to the referenced row
  - **Record**: every column as a key/value table
  - **Related entities**: one section per inbound FK (tables that reference
    this row), each with its own embedded entity list

## Safety

- Read-only: the app only issues `SELECT` statements.
- Table/column identifiers are always validated against introspected
  metadata and safely quoted; only values are parameterized.
- Use a read-only database role in `DATABASE_URL` for defense in depth.

## Setup

```bash
npm install
cp .env.example .env    # then edit DATABASE_URL
npm run dev             # http://localhost:3000
```

### Try it with a demo schema

Seed a small `users` / `posts` / `comments` dataset (with foreign keys) into
any database you can reach:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed.sql
npm run dev
```

Then open http://localhost:3000 — you can browse:
`users` → `posts` (via `author_id`) → `comments` (via `post_id`, `author_id`).

To isolate it from existing tables, seed into a dedicated schema and set
`PGSCHEMA`:

```bash
psql "$DATABASE_URL" -c 'CREATE SCHEMA IF NOT EXISTS demo'
psql "$DATABASE_URL?options=-c%20search_path%3Ddemo" -f scripts/seed.sql
# .env: PGSCHEMA=demo
```

(There is also a `scripts/seed.mjs` equivalent if you prefer Node; both run
DDL+DML against your database, so review before running against anything you
care about.)

## How it works

| Layer | File |
| --- | --- |
| Introspection | `src/server/introspect.ts` — reads tables, columns, PKs, FKs (outbound + inbound) from `information_schema` |
| Queries | `src/server/queries.ts` — safe, whitelisted `SELECT` executor |
| Server fns | `src/lib/functions.ts` — `createServerFn` RPC with zod validation |
| Query keys | `src/lib/queries.ts` — TanStack Query key factory + `queryOptions` |
| Routes | `src/routes/index.tsx`, `src/routes/entities/$table/index.tsx`, `src/routes/entities/$table/$pk.tsx` |
| UI | `src/components/EntityTable.tsx`, `src/components/CellValue.tsx` |

The cache of introspected schema is process-lifetime; restart the dev server
after changing your database schema.
