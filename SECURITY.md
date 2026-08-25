# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

Use GitHub's private reporting: the repository's **Security** tab →
**Report a vulnerability** (GitHub Security Advisories). We aim to acknowledge
reports within a few business days.

## Supported versions

This project is pre-1.0 (`0.x`). Only the latest `main` receives fixes.

## Scope & operational notes

eng-ops is a developer/ops tool that connects directly to a Postgres database:

- **No built-in authentication or authorization.** Anyone who can reach the
  running instance can browse — and, if writes are enabled, modify — everything
  the database role can see. **Run it locally or behind your own auth (VPN, SSH
  tunnel, or an authenticating reverse proxy). Never expose it directly to the
  internet.**
- **Least privilege.** Prefer a read-only database role. Writes are off by
  default; only set `ENGOPS_WRITE=1` with a writable role when you need editing.
- **Query safety.** Identifiers are validated against introspected metadata and
  quoted; values are always bound parameters; `UPDATE`/`DELETE` run in a
  transaction and roll back unless exactly one row is affected.
- **Secrets.** `DATABASE_URL` lives in `.env`, which is git-ignored. Never commit
  connection strings.

Deployment and configuration mistakes (e.g. exposing an instance publicly, or
enabling writes with an over-privileged role) are the responsibility of the
operator, but reports of unsafe defaults or documentation gaps are welcome.
