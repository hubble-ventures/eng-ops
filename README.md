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
- **Dark mode**, responsive layout (forms become bottom-sheets on mobile).
- **Works with managed Postgres** — TLS options for Neon / RDS / Supabase.

---

## Quick start

Requires **Node ≥ 20.19** and a reachable Postgres.

```bash
npm install
cp .env.example .env        # then edit DATABASE_URL
npm run dev                 # prints the URL it picked
npm run ports               # …or ask for it any time
```

The dev server does not use a fixed port. Each checkout claims its own stable
port block so parallel worktrees never collide — see [Ports](#ports).

### Don't have a database handy?

Spin up a throwaway Postgres and load a small demo schema
(`users` / `posts` / `comments`):

```bash
npm run db:up               # Postgres on this checkout's claimed port
npm run seed                # load the demo schema
npm run dev                 # serve the app
```

No `DATABASE_URL` editing is needed for the demo: `npm run db:up` publishes
Postgres on the port this checkout claimed, and the matching connection string
is written to `.worktree/ports.env`, which the app falls back to. A
`DATABASE_URL` in your real environment or in `.env` always wins over it —
pointing eng-ops at your own database stays the normal case.

Use `npm run db:down` to stop it, and `npm run ports:release` when you are done
with a checkout entirely.

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

### Ports

Nothing here listens on a fixed port. `scripts/portlock.mjs` claims a small
block per checkout, recorded in a machine-wide registry and written to
`.worktree/ports.env` (git-ignored):

| | |
| --- | --- |
| `POSTGRES_PORT` | `PORTBASE + 0` — the docker-compose Postgres |
| `WEB_PORT` | `PORTBASE + 1` — the Vite dev server |
| `DATABASE_URL` | the connection string for that Postgres |
| `COMPOSE_PROJECT_NAME` | so each checkout gets its own container and volume |

The claim is **stable**: the same directory gets the same block every time, so a
URL in your notes keeps working across restarts. That is the point — scanning
for the first free port means landing on 3000 one day and 3002 the next. Vite is
started with `strictPort`, so a taken port is a loud failure rather than a
silent drift. A block is released when its directory is deleted, or on
`npm run ports:release`.

Ports are *named* in one place (`renderEnv` in `scripts/lib/portlock.mjs`)
rather than recomputed as `PORTBASE + n` at each call site.

#### Named URLs with portless (optional)

[`portless`](https://github.com/vercel-labs/portless) replaces the port number
with a name. It is **opt-in and never required** — install it and `npm run dev`
picks it up; don't, and everything works exactly the same on the port.

```bash
npm i -g portless
portless trust                 # one-time: trust the local CA (asks for sudo)
npm run dev                    # -> https://eng-ops.localhost
```

In a linked git worktree `portless run` prepends the branch, so each worktree
gets its own URL (`https://<branch>.eng-ops.localhost`) with no extra config.

The two tools solve different halves and are wired to agree rather than compete:
**portlock decides the port, portless gives that port a name.** The seam is
`--app-port`, which tells portless to proxy the port already claimed instead of
assigning its own random one from 4000-4999. Without that they would fight —
which is exactly the objection that kept portless out of the paddles-up stack
(ADR 0034 D6). portlock also stays the authority for Postgres, which portless
cannot cover at all: the proxy is HTTP-only.

`PORTLESS=0 npm run dev` bypasses it for one run.

> [!NOTE]
> `portless trust` writes to the system trust store, and its default proxy
> listens on 443, which needs `sudo`. Run those yourself; `portless proxy start
> -p 1355` avoids the privileged port if you would rather not.

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

### Config file (`engops.config.json`)

Optional per-deployment tuning — see [`engops.config.example.json`](engops.config.example.json):

```jsonc
{
  "columnOrder": "smart",              // global default strategy
  "tables": {
    "public.users": {
      "columnOrder": ["id", "email", "name"],  // pin these first
      "displayColumn": "email"                  // label used when this table is FK-referenced
    }
  }
}
```

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
| Pure SQL builders (insert/update/delete) | `src/server/sql.ts` |
| Deployment config loader | `src/server/config.ts` |
| Port allocation (portlock) | `scripts/lib/portlock.mjs`, `scripts/portlock.mjs` |
| Dev launcher (portlock + portless) | `scripts/dev.mjs` |
| Server functions (RPC, zod-validated) | `src/lib/functions.ts` |
| Query keys + `queryOptions` + label helpers | `src/lib/queries.ts` |
| Refine data provider / notifications / row id | `src/lib/refine/*` |
| Data grid | `src/components/DataTable.tsx` |
| CRUD forms + dialogs | `src/components/RecordForm.tsx`, `RecordDialogs.tsx` |
| shadcn/ui primitives | `src/components/ui/*` |
| Routes | `src/routes/*` |

### Scripts

```bash
npm run dev            # dev server (HMR) on this checkout's claimed port
npm run build          # production build
npm run start          # run the production build
npm run typecheck      # tsc --noEmit
npm run seed           # load the demo schema into $DATABASE_URL
npm run db:up          # start the throwaway Postgres
npm run db:down        # stop it
npm run ports          # show this checkout's claimed ports
npm run ports:release  # give the port block back
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
