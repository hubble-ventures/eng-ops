# Running eng-ops

Every way of running eng-ops goes through the same entrypoint —
[`bin/eng-ops.mjs`](../bin/eng-ops.mjs) — so the container, the npm package and
a local checkout behave identically. This page is the reference; the
[README](../README.md#quick-start) has the short version.

> [!WARNING]
> eng-ops has **no authentication**. It binds to `127.0.0.1` unless you tell it
> otherwise. Only bind a public interface behind your own auth proxy, VPN, or
> SSH tunnel.

---

## The runtime contract

Whatever shape you run it in, this is what you get.

| | |
| --- | --- |
| **Entrypoint** | `eng-ops [options]` — `--help` lists every flag |
| **Config precedence** | command-line flags → environment variables → `./.env` → `./.worktree/ports.env` |
| **Required config** | `DATABASE_URL` only |
| **Listens on** | `$HOST:$PORT`, default `127.0.0.1:3000` |
| **Liveness** | `GET /healthz` → `200 {"status":"ok"}`, never touches Postgres |
| **Readiness** | `GET /readyz` → `200` when `SELECT 1` succeeds, `503` otherwise |
| **Preflight** | `eng-ops --check` validates config + connectivity and exits |
| **Startup gate** | `--wait-for-db [seconds]` blocks until Postgres answers |
| **Shutdown** | `SIGTERM`/`SIGINT` drain in-flight requests, then exit `0` |
| **Exit codes** | `0` success · `1` runtime/config failure · `2` bad usage |

`--check` is the fastest way to find out *why* something won't start:

```bash
eng-ops --check
# [eng-ops] ok — postgres://postgres:****@db:5432/postgres (postgres)
# [eng-ops] writes: disabled (read-only)
```

---

## npx

No clone, no build — the published package ships a prebuilt server.

```bash
npx @hubble-ventures/eng-ops --database-url postgres://user:pass@host:5432/db
```

Pin a version for anything repeatable, and prefer a read-only role:

```bash
npx @hubble-ventures/eng-ops@0.1.0 -d "$READONLY_DATABASE_URL" --port 4000
```

A `.env` in the current directory is picked up too, so `cd`-ing into a project
and running `npx @hubble-ventures/eng-ops` just works.

## Container

```bash
docker run --rm --init \
  -p 127.0.0.1:3000:3000 \
  -e DATABASE_URL=postgres://user:pass@host:5432/db \
  ghcr.io/hubble-ventures/eng-ops:latest
```

The entrypoint is the CLI, so flags pass straight through:

```bash
docker run --rm -e DATABASE_URL=… ghcr.io/hubble-ventures/eng-ops --check
docker run --rm -e DATABASE_URL=… ghcr.io/hubble-ventures/eng-ops --write --wait-for-db 60
```

Details worth knowing:

- Runs as the non-root `node` user; the image contains no shell tooling beyond
  what the Node base image ships.
- `HOST=0.0.0.0` is set inside the image (a container is already isolated) —
  publish the port to `127.0.0.1` on the host, as above.
- A `HEALTHCHECK` calls `/healthz`, so `docker ps` and `compose --wait` report
  real readiness.
- Tags: `latest` and `X.Y.Z` from releases, `edge` from `main`, `sha-…` per
  commit. Multi-arch (`linux/amd64`, `linux/arm64`).
- To point at Postgres on the Docker host, use
  `host.docker.internal` (macOS/Windows) or `--network host` (Linux).

Build it yourself with `npm run docker:build`, or against a different base:

```bash
docker build --build-arg NODE_IMAGE=node:22-alpine -t eng-ops:alpine .
```

## Sidecar

### …in a Compose stack

[`docker-compose.yml`](../docker-compose.yml) runs the demo stack. Ports are
claimed per checkout by `scripts/portlock.mjs`, so drive it through the npm
scripts rather than a bare `docker compose` — they pass `.worktree/ports.env`
through:

```bash
npm run db:up                                  # Postgres on the claimed port
npm run app:up                                 # the containerised app against it
npm run ports                                  # what did this checkout claim?
npm run app:down && npm run db:down            # stop
```

`app` sits behind a compose profile so `npm run db:up` still starts only the
database. `ENGOPS_WRITE=1 npm run app:up` enables writes; if you have Docker but
no local `psql`, `docker compose --profile seed run --rm seed` loads
`scripts/seed.sql` the same way `npm run seed` does.

To attach eng-ops to a stack you already have, add one service next to your
database — no other changes:

```yaml
services:
  eng-ops:
    image: ghcr.io/hubble-ventures/eng-ops:latest
    command: ['--wait-for-db', '60']
    environment:
      DATABASE_URL: postgres://postgres:postgres@db:5432/app
    depends_on:
      db:
        condition: service_healthy
    ports:
      - '127.0.0.1:3000:3000'
    init: true
```

### …in a Kubernetes pod

As its own deployment, or as an extra container beside an app that owns the
database. Both probes matter: `/healthz` says the process is alive, `/readyz`
holds traffic back while Postgres is unreachable.

```yaml
containers:
  - name: eng-ops
    image: ghcr.io/hubble-ventures/eng-ops:latest
    ports:
      - containerPort: 3000
    env:
      - name: HOST
        value: '0.0.0.0'
      - name: DATABASE_URL
        valueFrom:
          secretKeyRef:
            name: eng-ops-db
            key: url
    livenessProbe:
      httpGet: { path: /healthz, port: 3000 }
      periodSeconds: 15
    readinessProbe:
      httpGet: { path: /readyz, port: 3000 }
      periodSeconds: 10
    securityContext:
      runAsNonRoot: true
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
    resources:
      requests: { cpu: 50m, memory: 128Mi }
      limits: { memory: 512Mi }
```

Put an authenticating ingress or a service mesh in front of it — eng-ops
authenticates nobody.

## From a checkout

```bash
npm install                  # applies patches and builds if there is no dist/
npm run dev                  # dev server with HMR on the claimed port
npm run build && npm start   # production build, then serve it
npm run check                # preflight only
npm run ports                # which ports did this checkout claim?
```

`npm run dev` and `npm start` both go through `scripts/portlock.mjs`, which
gives each checkout a stable port block so parallel worktrees never collide —
neither one listens on a fixed 3000. To choose the port yourself, call the CLI
directly: `node bin/eng-ops.mjs --port 4000 --write`.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `DATABASE_URL is not set` | No flag, no env var, no `.env` and no `.worktree/ports.env` in the working directory. The message prints both paths it looked in. |
| `no production build found` | A checkout without `dist/`. Run `npm run build`. |
| `database not reachable within Ns` | `--wait-for-db` timed out. Check the host/port from *inside* the container (`db:5432`, not `localhost:5432`). |
| `/readyz` returns 503 | The app is up but Postgres is not answering. The response body carries the driver's error. |
| `port is already allocated` | Something owns the port. In a checkout, `npm run ports` shows the claimed block and `npm run ports:release` gives it back; standalone, pass `--port`. |
| Schema changes don't appear | Introspection is cached for the process lifetime. Restart the server. |
