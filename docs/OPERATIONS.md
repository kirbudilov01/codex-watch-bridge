# Operations

## Local Services

The bridge is managed by launchd:

```sh
npm run service:install
npm run service:status
```

The remote tunnel is also managed by launchd:

```sh
npm run tunnel:install
npm run tunnel:status
```

## Public URL

The watch currently uses an HTTPS reverse proxy path:

```text
https://ubtflow.com/codex-watch-bridge/
```

The server-side nginx location proxies that path to a loopback remote-forward port. The Mac opens the SSH reverse tunnel back to the server.

## If Projects Load Slowly

Run:

```sh
npm run doctor
```

The `projectsLatencyMs` value should normally be under a few seconds. The bridge prefers Codex Desktop app-server `thread/list` and caches the project list briefly. If Codex Desktop is closed, it falls back to scanning local Codex session files, which can be slower on large histories.

## If Tunnel Fails

Check:

```sh
tail -80 ~/.codex-watch-bridge/tunnel.err.log
ssh trendvi-prod-current 'ss -ltn'
```

If the remote-forward port is stuck on the server, pick a free `CODEX_WATCH_REMOTE_PORT`, reinstall the tunnel, and update the nginx proxy target to the same port.
