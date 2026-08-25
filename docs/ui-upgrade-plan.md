# Entity-browser UI upgrade plan

Two phases, incremental. Phase 1 modernises the read-only inspector on the
current stack (TanStack Start + Router + Query) by adopting **TanStack Table**
and **shadcn/ui**. Phase 2 layers **Refine** on top for full CRUD, reusing the
existing server functions via a custom data provider.

> **Status:** Phase 1 and Phase 2 are implemented.
> - **Phase 1:** design system, sidebar shell, DataTable with server
>   sort/search/pagination, record view, dark mode, command palette, toasts;
>   "any Postgres" hardening (SSL, views/matviews, configurable column
>   ordering); upstream `router-ssr-query-core` stream bug patched.
> - **Phase 2:** richer column metadata (identity/generated/default/maxLength/
>   enum) + composite-PK-aware write backend (create/update/delete) gated by
>   `ENGOPS_WRITE`; Refine mounted headlessly over a custom data provider with
>   auto-generated forms, delete confirmation, and sonner notifications.
>   Verified end-to-end against a throwaway Postgres.
>
> Not yet done (Phase 2 follow-ups): searchable FK pickers in forms (FK fields
> are plain typed inputs today), composite-PK record *viewing* (the detail
> route still identifies a row by a single PK value, though writes derive the
> full key from the loaded row), and richer constraint metadata (CHECK/unique).

## Starting point (as of this branch)

- **Server fns** (`src/lib/functions.ts`) → introspection (`src/server/introspect.ts`)
  + row queries (`src/server/queries.ts`) → `pg` Pool. SQL is already safe:
  quoted identifiers, columns validated against introspected metadata,
  parameterized values.
- **Query layer** (`src/lib/queries.ts`): `queryOptions` + hierarchical `entityKeys`.
- **UI**: hand-rolled `<table>` (`src/components/EntityTable.tsx`) + `CellValue`,
  plain CSS (`src/styles.css`). Pagination via URL search params.
- **Gaps**: no sort / ORDER BY, no user-facing filter/search, no column
  controls, no CRUD, no design system.
- Path alias is `~/*` (not shadcn's default `@/*`).

---

## Phase 1 — TanStack Table + shadcn/ui (read-only, keep architecture)

### 1a. Tooling & design system
- Add Tailwind v4 via `@tailwindcss/vite`, `@tanstack/react-table`, and shadcn
  deps (`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`,
  Radix primitives).
- `cn()` util in `src/lib/utils.ts`. `components.json` aliases pointed at `~/*`.
- Design tokens (light + dark) as CSS variables in the Tailwind theme layer;
  retire `styles.css` incrementally.

### 1b. App shell (`src/routes/__root.tsx`)
- Sidebar (searchable table list, grouped by schema) + top bar + breadcrumb.
- Dark mode via `.dark` class + tokens.

### 1c. Reusable `DataTable` (headless react-table)
- **Dynamic** `ColumnDef[]` generated from `TableMeta.columns` (schemas differ
  per table). Cells reuse the FK-link / NULL / boolean logic from `CellValue`.
- `manualPagination` + `manualSorting` + `manualFiltering`, state driven from
  **URL search params** (fits Router's `validateSearch`) → server fns.
- Column-visibility dropdown, density toggle, sticky header, horizontal scroll;
  optional `@tanstack/react-virtual` for large tables.

### 1d. Safe server additions
- `orderBy` / `orderDir` on `listRows` + `rowsInput`, validated with the
  existing `assertColumn` guard → real sorting.
- Per-column `ILIKE` search / global text search across text columns
  (column-validated + parameterized).

### 1e. Routes
- `entities/$table/index.tsx`: add `sort`/`dir`/`filter` to the search schema;
  render `DataTable`; page-size selector.
- `$pk.tsx`: record view as shadcn card + description list; related entities as
  tabs.
- `index.tsx`: sidebar + command-palette (`cmdk`) table search.

### 1f. Polish
- Loading skeletons, empty states, Router `errorComponent` boundaries, toasts
  (`sonner`). Fix the `@tanstack/react-router-ssr-query` `mutations` hydration
  warning.

**Result:** same inspector, now with sortable/filterable/configurable grids,
command-palette navigation, an admin shell, dark mode, and proper
loading/empty/error UX.

---

## Phase 2 — Refine for full CRUD

Refine runs on TanStack Query internally, so it coexists with the existing
`QueryClient`. Prefer **headless Refine hooks** with TanStack Router as the
source of truth (avoids depending on a first-party TanStack Router adapter;
verify current adapter availability before committing).

### 2a. Write-side backend (new server fns)
- `createRow`, `updateRow`, `deleteRow` mirroring the safe pattern in
  `queries.ts`: quoted idents, column allowlist from introspection, PK-scoped
  `WHERE`, parameterized values, transaction-wrapped.
- **Safety gate:** writes off by default behind `ENGOPS_WRITE=1`;
  `.env.example` documents that CRUD needs a writable role. Destructive ops
  require confirm; keep PII discipline.

### 2b. Data provider
- Implement Refine's `DataProvider` (`getList/getOne/getMany/create/update/
  deleteOne`) mapping to the server fns; resource name = table id. Filters /
  sorters / pagination map onto the params added in Phase 1.

### 2c. Refine setup
- Mount `<Refine>` inside existing providers; **dynamically register resources**
  from introspection (every table → list/show/create/edit).

### 2d. Pages via Refine hooks
- List: `useTable` → feeds the Phase-1 `DataTable`.
- Show: `useShow` → reuse the record card.
- Create/Edit: `useForm` + **forms auto-generated from `TableMeta.columns`**
  (input type by pg `udtName`; FK fields → `useSelect`), Zod validation.
- Delete: `useDelete` with confirm dialog + optimistic/undoable + toast.

### 2e. Leverage Refine freebies
- `@refinedev/inferencer` to auto-scaffold CRUD from schema; optional
  access-control provider (per-table/op permissions); export.

### 2f. Cutover
- Migrate route-by-route, keeping Phase-1 read paths live until each Refine page
  lands; typecheck + browser smoke each step.

---

## Cross-cutting risks
- **SSR**: Refine is client-oriented; keep Query loaders for first-paint SSR and
  let Refine hydrate on the client.
- **Alias** `~` vs shadcn's `@` — resolved via `components.json`.
- **Tailwind v4** (not v3) with `@tailwindcss/vite`; preflight resets may affect
  not-yet-migrated pages during the transition.
- **Write safety** (Phase 2): flag-gated, role-documented, parameterized,
  PK-scoped, transactional.
- **Dynamic columns/forms** need generic typing (`Record<string, JsonScalar>`).

## Checkpoints
1. **P1a** tooling + shell + `DataTable` on one table.
2. **P1b** sort/filter/search across all tables + polish.
3. **P2a** read-only data provider + Refine list/show.
4. **P2b** write fns + create/edit/delete behind the flag.
