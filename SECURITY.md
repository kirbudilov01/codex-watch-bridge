# Security Policy

## Supported Scope

This repository is a private local bridge and watchOS client. It is not a public multi-tenant service.

## Secrets

- Do not commit `WatchApp/Config.xcconfig`.
- Do not put OpenAI, Codex, SSH, Apple, or server credentials in the watch app.
- Use `CODEX_WATCH_BRIDGE_TOKEN` on the bridge and `CODEX_BRIDGE_TOKEN` in the watch build settings.
- Keep bridge runtime state under `~/.codex-watch-bridge`.

## Network Exposure

The watch app should talk only to the bridge HTTPS URL. The bridge must require bearer-token authentication when exposed outside localhost or LAN.

The public reverse proxy should terminate HTTPS and forward only to the Mac-originated SSH reverse tunnel. Do not expose the local bridge port directly to the internet.

## Operational Checks

Run before installing or after changing networking:

```sh
npm run check
npm run service:status
npm run tunnel:status
```

Expected public behavior:

- authenticated `/health`, `/projects`, and `/limits` return `200`;
- unauthenticated requests return `401`;
- `/projects` returns quickly, normally within a few seconds.
