# eng-ops

A generic, **introspection-driven admin UI for any Postgres database**. Point it
at a connection string and it reads your schema (`pg_catalog`) and generates the
whole UI from your real tables, views, columns, and foreign keys — browse,
search, sort, and (optionally) create/update/delete rows. No per-database code,
no codegen.

Built with **TanStack Start** (SSR + server functions), **TanStack Router**,
**TanStack Query**, **TanStack Table**, **shadcn/ui** (Tailwind v4), and
**Refine** for the CRUD layer.

> [!WARNING]
> **eng-ops has no authentication and no authorization.** Anyone who can reach
> the port can browse — and, if writes are enabled, modify — every table the
> database role can see. Run it **locally** (or behind your own auth proxy / VPN
> / SSH tunnel). **Never expose it directly to the internet.** It is a
> developer/ops tool, not a multi-tenant application.

---

## Features

- **Zero-config schema discovery** — tables, views, materialized views, foreign
  tables, columns, primary keys (incl. composite), foreign keys (outbound +
  inbound), enums, defaults, and identity/generated columns, all from
  `pg_catalog`.
- **Entity browser** — a searchable, sortable, paginated data grid per table;
  server-side sort/search/pagination via URL params; column show/hide and a
  density toggle; sticky primary-key and action columns.
- **Row detail** — every column, outbound FK "References", and inbound
  "Related entities" sections.
- **Foreign-key labels** — FK values render as the referenced row's human label
  (e.g. `Acme Inc #1`), not just the id.
- **Command palette** — `⌘K` / `Ctrl-K` to jump to any table.
- **Optional CRUD** — create/update/delete with auto-generated forms (enum
  selects, checkboxes, typed inputs, defaults honored, required validation),
  **off by default** (see [Enabling writes](#enabling-writes)).
- **Row merge** — reassign everything that references one row onto another and
  retire the leftover, driven entirely by `pg_catalog`; also **off by default**
  (see [Merging rows](#merging-rows)).
- **Dark mode**, responsive layout (forms become bottom-sheets on mobile).
- **Works with managed Postgres** — TLS options for Neon / RDS / Supabase.

---

## Quick start

Requires **Node ≥ 20.19** and a reachable Postgres.

```bash
npm install
cp .env.example .env        # then edit DATABASE_URL
npm run dev                 # http://localhost:3000
```

### Don't have a database handy?

Spin up a throwaway Postgres and load a small demo schema
(`users` / `posts` / `comments`):

```bash
docker compose up -d        # Postgres on localhost:5432
npm run seed                # load the demo schema
npm run dev                 # http://localhost:3000
```

The default `DATABASE_URL` in `.env.example`
(`postgres://postgres:postgres@localhost:5432/postgres`) matches the compose
file, so no editing is needed for the demo.

> `npm run seed` runs DDL + DML (drops/recreates `users`/`posts`/`comments`).
> Only run it against a database you're happy to modify. To isolate it, create a
> dedicated schema and set `PGSCHEMA` (see below).

---

## Configuration

All settings come from `.env` (or real environment variables, which win).
Only `DATABASE_URL` is required.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | Postgres connection string (`postgres://…` or `postgresql://…`). **Required.** Use a **read-only role** unless you need writes. |
| `PGSCHEMA` | all non-system schemas | Comma-separated schema allowlist to introspect, e.g. `public,app`. |
| `PGSSLMODE` | defer to connection string | TLS mode (libpq-style): `disable` \| `require` \| `no-verify` \| `verify-ca` \| `verify-full`. Set this for managed hosts that require TLS. |
| `PGSSLROOTCERT` | — | Path to a CA PEM used when `PGSSLMODE` is `verify-ca`/`verify-full`. |
| `ENGOPS_WRITE` | off | `1`/`true` enables create/update/delete. See below. |
| `ENGOPS_CONFIG` | `./engops.config.json` | Path to the optional JSON config file. |
| `ENGOPS_COLUMN_ORDER` | `natural` | Global column-ordering strategy: `natural` (DB order) or `smart` (PK → name-like → FKs first, audit timestamps last). |

The introspected schema is cached for the process lifetime — **restart the dev
server after changing your database schema.**

### Enabling writes

eng-ops is a **read-only browser by default** (only `SELECT`s are issued). To
allow create/update/delete:

1. Set `ENGOPS_WRITE=1` in `.env`.
2. Use a `DATABASE_URL` whose role actually has write privileges.

Write safety: identifiers are always validated against introspected metadata and
quoted; values are always bound parameters; `UPDATE`/`DELETE` run in a
transaction and roll back unless exactly one row is affected. Generated/identity
columns are never written. The write UI (New row / Edit / Delete) is hidden when
`ENGOPS_WRITE` is off and for non-table relations (views).

### Merging rows

Two rows of the same table often turn out to be the same thing: a user who
signed up twice, a tag created under two slugs. **Merge** (on any record's
detail page, when writes are enabled) reassigns every row that references the
one you are looking at onto a row you pick, then retires the leftover — all in
one transaction, and only after showing you exactly what it would do.

Nothing about it is table-specific. The reference graph comes from
`pg_constraint`, the uniqueness rules from `pg_index`, and "do these two rows
say the same thing?" from column metadata — so it works on any schema.

**What it does**

1. **Discovers** every foreign key pointing at the table.
2. **Classifies collisions.** Where a unique index keys on a referencing column,
   both rows can hold a row in one scope and only one may survive. Rows that
   agree on every meaningful column are an exact duplicate and the leftover's
   copy is dropped; rows that disagree **block** the merge, naming the columns
   and linking straight to the rows to fix. Nothing is auto-resolved.
   Primary-key, identity and generated columns are excluded from that comparison
   from introspection; the remaining exclusions (`created_at`, `updated_at`) are
   configurable.
3. **Reassigns** what is left.
4. **Sweeps, then retires.** Before touching the merged-away row it asserts that
   *nothing anywhere* still references it, and rolls back if anything does. This
   is the important one: foreign keys are frequently `ON DELETE CASCADE`, so a
   reference the tool missed would be silently destroyed rather than raise. The
   row is then stamped with a soft-delete column if the table has one
   (`deleted_at` by default, configurable), and deleted outright — and returned
   in full — if it does not.

It also refuses, rather than guessing, when it meets a composite foreign key, a
unique expression index, a unique index keyed on two referencing columns at
once, or a self-reference that would leave the surviving row pointing at itself.

> [!IMPORTANT]
> **A merge is only as safe as the foreign keys actually declared.** A column
> that references the table without a constraint — a polymorphic `owner_id`, or
> one that simply never got one — is invisible to `pg_catalog`: it will not be
> reassigned, the sweep will not see it, and it will be left dangling with no
> error. Declare those edges in `engops.config.json` (below). The merge dialog
> says as much, every time.
>
> Triggers on the reassigned tables fire as part of the merge, and this tool
> cannot know what they do; the plan lists them.

### Config file (`engops.config.json`)

Optional per-deployment tuning — see [`engops.config.example.json`](engops.config.example.json):

```jsonc
{
  "columnOrder": "smart",              // global default strategy
  "merge": {
    "ignoredColumns": ["created_at", "updated_at"],   // don't count as "information"
    "tombstoneColumns": ["deleted_at", "archived_at"] // stamp instead of deleting
  },
  "tables": {
    "public.users": {
      "columnOrder": ["id", "email", "name"],  // pin these first
      "displayColumn": "email",                 // label used when this table is FK-referenced
      "merge": {
        // References with no foreign key to find them by. `guard` narrows a
        // polymorphic column to the rows that actually point at this table.
        "extraEdges": [
          { "table": "public.audit_log", "column": "owner_id", "guard": "owner_type = 'user'" }
        ]
      }
    }
  }
}
```

`guard` is raw SQL spliced into the edge's `WHERE` clause. It is operator
config, trusted at the same level as `DATABASE_URL` — it is not, and cannot be,
validated as safe input.

---

## How it works

Structure is derived from **introspection**; row data comes from **live
queries**. Nothing is hardcoded per table.

| Layer | File |
| --- | --- |
| Env parsing & validation | `src/server/env.ts` |
| Connection pool + TLS | `src/server/db.ts` |
| Introspection (`pg_catalog`) | `src/server/introspect.ts` |
| Read queries + write ops + FK labels | `src/server/queries.ts` |
| Row-merge planner + executor | `src/server/merge.ts` |
| Pure SQL builders (insert/update/delete) | `src/server/sql.ts` |
| Deployment config loader | `src/server/config.ts` |
| Server functions (RPC, zod-validated) | `src/lib/functions.ts` |
| Query keys + `queryOptions` + label helpers | `src/lib/queries.ts` |
| Refine data provider / notifications / row id | `src/lib/refine/*` |
| Data grid | `src/components/DataTable.tsx` |
| CRUD forms + dialogs | `src/components/RecordForm.tsx`, `RecordDialogs.tsx` |
| Merge dialog | `src/components/MergeRecordDialog.tsx` |
| shadcn/ui primitives | `src/components/ui/*` |
| Routes | `src/routes/*` |

### Scripts

```bash
npm run dev        # dev server (HMR) on :3000
npm run build      # production build
npm run start      # run the production build
npm run typecheck  # tsc --noEmit
npm run seed       # load the demo schema into $DATABASE_URL
```

---

## For AI agents

This repo is set up for agent-assisted development and UI testing:

- **`AGENTS.md`** — conventions, how to run/verify, and safety rules for agents.
- **Argent** ([`@swmansion/argent`](https://github.com/software-mansion/argent))
  is a committed dev dependency. Its MCP server (`.mcp.json`) and skills
  (`.argent/`) let an agent drive the app in a real Chromium (via CDP) to
  perform and verify CRUD flows. The CLI works without an editor restart:

  ```bash
  # launch Chrome with a debugging port, then:
  npx argent run list-devices
  npx argent run screenshot --udid chromium-cdp-9222
  ```

- **Verify writes against a throwaway database**, never production data — see
  `docker-compose.yml` and `npm run seed`.

---

## Roadmap

- [`docs/ui-upgrade-plan.md`](docs/ui-upgrade-plan.md) — the TanStack Table +
  shadcn (Phase 1) → Refine CRUD (Phase 2) plan.
- [`docs/ux-improvements.md`](docs/ux-improvements.md) — the developer-UX audit
  and prioritized backlog (P0/P1 done; P2/P3 open — searchable FK pickers,
  mobile card view, bulk actions, export, etc.).

---

## Security

- **No auth** — see the warning at the top. Do not expose publicly.
- **SQL safety** — identifiers are whitelisted against introspection and quoted;
  values are parameterized; writes are transactional and single-row-guarded.
- **Least privilege** — prefer a read-only role; only grant write privileges and
  set `ENGOPS_WRITE=1` when you need editing.
- **Secrets** — `.env` is git-ignored; never commit real connection strings.
- Please report vulnerabilities privately to the maintainer rather than opening a
  public issue.

## Contributing

Issues and PRs welcome. Before submitting: `npm run typecheck` should pass, and
match the existing code style (functional components, `~/`-aliased imports,
server-only code under `src/server`).

## License

[MIT](LICENSE) © 2026 Hubble Ventures
