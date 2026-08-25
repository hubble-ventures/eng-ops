# eng-ops developer-UX audit & improvement plan

Findings from an Argent-driven CRUD walkthrough (Chromium via CDP) against a
seeded throwaway database, exercising create/edit/delete on desktop (1440×900)
and mobile (402×874), across a wide table (`users`, 12 cols), a composite-PK
table (`memberships`), and a view (`active_users`).

Ordered by impact × effort. P0 = do first.

> **Status:** P0 and P1 are implemented and verified via an Argent walkthrough
> against a throwaway DB — row-click-to-open, sticky PK/actions columns, form
> field fixes (hidden serial/`nextval` + generated/identity columns, semantic
> input types, single-line inputs, defaults honored, required markers + inline
> required validation), responsive bottom-sheet forms on mobile, a row kebab
> (Open/Edit/Delete), and FK display labels (list cells, record view, and
> References). Remaining: P2/P3 below, plus list-cell datetime pickers and
> searchable FK pickers (#11).

## P0 — high impact, low effort

### 1. Rows aren't openable; the action is hidden off-screen
On a 12-column table the `view` link sits at the far right, past a horizontal
scroll; on mobile it's entirely off-screen. Rows have no click affordance.
**Fix:** make the whole row clickable → navigate to the record; add
`cursor-pointer` + row hover highlight; make rows keyboard-focusable (Enter to
open). Drop the dedicated `view` column (or fold it into a right-aligned kebab).

### 2. Wide tables hide context and actions on scroll
Scrolling right loses the `id`/first column and the row actions.
**Fix:** sticky-pin the primary-key (left) and the actions/kebab (right)
columns so identity and actions stay visible while scrolling.

### 3. Create form asks for auto-generated primary keys
`id (pk)` renders as an editable **"integer · required"** field even though it's
a serial with a default; `created_at` (default `now()`) is also shown.
**Fix:** on create, hide identity columns and columns whose default is a
sequence/`now()` etc.; if shown, label them "auto" and treat as optional. Fix
the required/optional hint to respect `hasDefault`.

### 4. Every text column becomes a giant textarea; no input semantics
`email` and `full_name` are multi-line textareas; numbers/dates are plain text.
**Fix:** single-line `Input` for short text; textarea only for long/`json`;
semantic types — `email`→email, numeric→number (with step), `timestamptz`→
datetime-local, `date`→date. Add placeholders/format hints.

### 5. Column defaults ignored for booleans/enums
New `is_active` shows **false** though the DB default is `true`; required enums
default to `(none)` and only fail on submit.
**Fix:** seed new-row fields from the column default (parse `hasDefault`/default
expr); default required enums to their default or first value.

## P1 — high impact, medium effort

### 6. Forms are centered overlay modals on every breakpoint
On mobile the form floats as a cramped centered card with the list peeking
around it.
**Fix:** a responsive dialog — bottom-sheet/drawer on small screens
(full-width, near-full-height, sticky header + sticky footer actions), centered
dialog on desktop. (shadcn Drawer / vaul, or a `useMediaQuery` switch.)

### 7. Foreign keys show raw ids everywhere
Cells, the References card, and the record view all show `org_id: 1` — no
human-readable label, so a developer must memorize ids.
**Fix:** resolve each FK to a display label (a name-like/text column of the
referenced table, configurable per table in `engops.config.json`), showing the
label with the id as secondary.

### 8. Validation only surfaces as a server error after submit
No inline required/format checks; a bad value round-trips to Postgres.
**Fix:** client-side validation (required, maxLength, number/email/json),
required-field markers, submit disabled until valid.

### 9. No inline row actions
Edit/Delete require opening the record first.
**Fix:** a right-aligned row kebab (Open, Edit, Delete, Copy id) on the list.

## P2 — polish / power-user

### 10. Mobile tables should stack into cards
On phones, render each row as a compact card (a few key columns) that taps
through to the record, instead of a horizontally-scrolling table.

### 11. Searchable FK picker in forms
Replace the raw FK number input with an async combobox that searches the
referenced table (deferred from Phase 2).

### 12. Command palette actions
Extend ⌘K beyond table navigation: "New row in <table>", "Toggle theme", jump
to a record by primary key.

### 13. Copy affordances
Copy-cell / copy-row-as-JSON — developers constantly lift ids and values.

## P3 — larger features

- Bulk selection + actions (multi-delete, export selected).
- Export current view to CSV/JSON.
- "Duplicate row" / insert-similar.
- Composite-PK record *viewing* (detail route still identifies by a single PK
  value; writes already use the full key).

## Suggested sequencing
1. **P0 batch** — row-click-to-open + sticky pk/actions columns + form field
   fixes (auto-pk, input types, defaults). Mostly `DataTable.tsx` and
   `RecordForm.tsx`; no schema changes.
2. **Responsive drawer** (#6) + **FK labels** (#7) + **inline validation** (#8)
   + **row kebab** (#9).
3. P2 polish, then P3 features.
