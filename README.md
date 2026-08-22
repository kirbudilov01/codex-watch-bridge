<div align="center">

# Codex Watch Bridge

**Run real Codex tasks from Apple Watch.**

![License](https://img.shields.io/badge/license-MIT-green)
![watchOS](https://img.shields.io/badge/watchOS-10.0%2B-0A84FF)
![SwiftUI](https://img.shields.io/badge/SwiftUI-watch%20client-orange)
![Node.js](https://img.shields.io/badge/Node.js-bridge-339933)
![Status](https://img.shields.io/badge/status-working%20prototype-blue)

Apple Watch client + Mac bridge for opening Codex projects, reading chats, dictating prompts, creating new threads, tracking live status, and seeing account limit remaining percentage from your wrist.

[Features](#features) · [Architecture](#architecture) · [Quickstart](#quickstart) · [Remote Access](#remote-access) · [Security](#security)

![Codex Watch Bridge UI mockups](docs/watch-ui-mock.png)

</div>

## Why This Exists

Codex is powerful, but checking whether a task is still running should not require opening a laptop. Codex Watch Bridge gives operators a small, focused watchOS surface for the things that matter in the middle of work:

- Which project am I in?
- Which thread is active?
- Is Codex still working, waiting, failed, or done?
- Can I dictate the next prompt now?
- Did the answer arrive?

No fake chat layer. No OpenAI keys on the watch. The watch talks to a bridge, and the bridge talks to the real Codex environment on your Mac.

## Features

| Area | What works |
| --- | --- |
| Projects | Lists recent Codex projects in a watch-friendly view. |
| Threads | Opens existing Codex chats/threads and previews status. |
| Messages | Reads user, assistant, and status messages in order. |
| New Chat | Creates a new Codex thread from Apple Watch. |
| Dictation | Uses native watchOS text input for dictated prompts and titles. |
| Sending | Sends prompts into the current thread, not a duplicate session. |
| Status | Normalizes `idle`, `queued`, `running`, `waiting_for_input`, `completed`, `failed`, `cancelled`. |
| Limits | Shows account limit remaining percentage on the watch Home screen. |
| Remote Use | Supports HTTPS access through a Mac-originated reverse tunnel. |
| Safety | Keeps Codex/OpenAI secrets server-side. |

## Watch Flow

```text
Home
  -> Projects
    -> Project
      -> Chats
        -> Chat
          -> Dictate prompt
          -> Send
          -> Watch status
          -> Read response

Chats
  -> New Chat
    -> Dictate title
    -> Create
    -> Chat
```

## Architecture

```text
Apple Watch
  -> Bridge API over LAN/HTTPS
    -> Mac launchd bridge
      -> Codex Desktop app-server
      -> Codex CLI fallback
      -> ~/.codex session JSONL fallback
```

The watch app consumes normalized application models:

- `Project`
- `CodexThread`
- `ChatMessage`
- `ThreadStatus`
- `AccountLimits`

This keeps SwiftUI away from raw Codex internals and lets the backend preserve compatibility as Codex storage/API behavior changes.

## Repository Layout

```text
WatchApp/                 SwiftUI watchOS client
src/                      Node bridge backend
scripts/                  launchd, tunnel, doctor, and check scripts
test/                     backend tests
docs/                     operations notes and watch UI mockups
CodexAppleWatch.xcodeproj Xcode project for the watch target
```

## Requirements

- macOS with Xcode.
- Apple Watch running watchOS 10.0 or later.
- Node.js 20 or later.
- Codex Desktop running on the Mac for best app-server integration.
- Optional SSH server plus Nginx/Caddy/Cloudflare Tunnel for access outside home Wi-Fi.

## Quickstart

```sh
npm run check
npm run doctor
npm run dev
```

Default local bridge:

```text
http://127.0.0.1:8765
```

For a physical Apple Watch, use either the LAN URL printed by `npm run dev` or a public HTTPS reverse proxy URL in `WatchApp/Config.xcconfig`.

Use `WatchApp/Config.example.xcconfig` as the safe template:

```xcconfig
PRODUCT_BUNDLE_IDENTIFIER = com.example.codexwatch
DEVELOPMENT_TEAM =
CODEX_BRIDGE_URL = https:/$()/YOUR_DOMAIN/codex-watch-bridge/
CODEX_BRIDGE_TOKEN =
MARKETING_VERSION = 0.1
CURRENT_PROJECT_VERSION = 1
```

The `http:/$()/...` and `https:/$()/...` form is intentional because `//` starts comments in `.xcconfig` files.

## Remote Access

For using the watch away from home Wi-Fi, keep Codex Desktop running on the Mac and expose the bridge through a server-side HTTPS reverse proxy plus a Mac-originated SSH reverse tunnel:

```sh
npm run service:install
npm run tunnel:install
npm run service:status
npm run tunnel:status
```

The tunnel service maps a loopback port on the SSH server to the Mac bridge at `127.0.0.1:8767`. Nginx can then proxy a public HTTPS path such as `/codex-watch-bridge/` to that loopback port.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Bridge health check. |
| `GET` | `/projects` | List normalized projects. |
| `GET` | `/limits` | Return account usage/remaining limit data. |
| `GET` | `/projects/:projectId/threads` | List project threads. |
| `POST` | `/projects/:projectId/threads` | Create a new thread with display title. |
| `GET` | `/threads/:threadId` | Read thread summary. |
| `GET` | `/threads/:threadId/messages` | Read ordered message history. |
| `POST` | `/threads/:threadId/messages` | Send a prompt into the existing thread. |
| `GET` | `/threads/:threadId/status` | Read normalized task status. |

## Watch App

Open `CodexAppleWatch.xcodeproj` in Xcode, set your Apple Developer Team on the `CodexWatchApp` target, and run the app on a paired Apple Watch.

Swift sources live under `WatchApp/`. Text entry uses native watchOS controls, so dictation, keyboard, and Scribble behavior stay under standard watchOS behavior.

## Checks

```sh
npm test
swift build
npm run doctor
```

Generic watchOS build:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild \
  -project CodexAppleWatch.xcodeproj \
  -scheme CodexWatchApp \
  -destination 'generic/platform=watchOS' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## Security

- Do not put OpenAI keys, Codex secrets, cookies, or session files in the watch app.
- Do not commit `WatchApp/Config.xcconfig`; it can contain a bridge bearer token.
- Use HTTPS for remote access.
- Prefer a random bearer token for the bridge.
- Keep the Mac bridge behind a reverse proxy path, not a broad public port.

See `SECURITY.md` for the full policy.

## Operations

See `docs/OPERATIONS.md` for:

- launchd service management;
- tunnel management;
- slow project list troubleshooting;
- bridge unavailable checks;
- physical Apple Watch notes.

## Open Source Hygiene

- MIT license.
- Contribution guide.
- Code of Conduct.
- Security policy.
- Issue and PR templates.
- Local secret/config files ignored.
- Reproducible local checks through `npm run check`.

## License

MIT
