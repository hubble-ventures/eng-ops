# AGENTS.md

Guidance for AI agents working in this repo. (Humans: see [README.md](README.md).)

## What this is

`eng-ops` — a generic, introspection-driven Postgres admin UI (TanStack Start +
Router + Query + Table, shadcn/ui, Refine). Structure comes from `pg_catalog`
introspection; row data from live queries. Nothing is hardcoded per table.

## Run & verify

```bash
npm install
npm run typecheck        # must pass before you consider a change done
npm run dev              # prints the URL; `npm run ports` reprints it
```

- **Nothing listens on a fixed port.** `scripts/portlock.mjs` claims a stable
  block per checkout (`.worktree/ports.env`, git-ignored) so parallel worktrees
  do not collide. Read the port from there or from `npm run ports` — never
  assume 3000 or 5432, and never add a hardcoded port back.
- `DATABASE_URL` in `.env` is required unless you use the throwaway stack:
  `npm run db:up && npm run seed` publishes Postgres on the claimed port and
  supplies the matching `DATABASE_URL`. Anything in the real environment or
  `.env` wins over it.
- The introspection cache is process-lifetime — **restart the dev server after
  a schema change.**
- Prefer verifying real behavior over asserting it: drive the running app and
  check the result.

## Safety rules (important)

- **Never run destructive SQL against a database you don't own.** Assume the
  configured `DATABASE_URL` may point at real data with real PII — keep it out
  of commits, screenshots, and logs.
- **To test writes (create/update/delete), use a throwaway database** (see
  `docker-compose.yml` / `npm run seed`) with `ENGOPS_WRITE=1`. Do not enable
  writes against production.
- `.env` is git-ignored and must stay that way. Never commit connection strings.
- Writes are off unless `ENGOPS_WRITE` is set; keep that default.

## Driving the UI (Argent)

Argent (`@swmansion/argent`) is a dev dependency; its MCP server is configured in
`.mcp.json` (loads on editor restart) and its CLI works immediately:

```bash
# start Chrome with CDP first, pointing at the port `npm run ports` reports:
# "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
#   --remote-debugging-port=9222 --headless=new "http://localhost:$WEB_PORT"
npx argent run list-devices                     # find the chromium id
npx argent run screenshot --udid chromium-cdp-9222
npx argent run gesture-tap --udid chromium-cdp-9222 --x 0.5 --y 0.3
```

If port 9222 is already taken by another Chrome, use a different port and pass
`ARGENT_CHROMIUM_PORTS=<port>`; always target *your* `chromium-cdp-<port>` id.

## Conventions

- TypeScript, strict; functional React components.
- Imports use the `~/` alias for `src/`.
- Server-only code lives under `src/server/` (never import it into client code
  except through `src/lib/functions.ts` server functions).
- SQL: quote identifiers (`src/server/sql.ts`), validate columns against
  introspected metadata, and always use bind parameters — never interpolate
  values.
- shadcn/ui primitives live in `src/components/ui/`.

## Key files

See the "How it works" table in [README.md](README.md#how-it-works).
