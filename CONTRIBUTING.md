# Contributing

Codex Watch Bridge is intentionally small: a Node bridge, a watchOS SwiftUI client, and a static project page.

## Local Checks

Run the full local gate before opening a pull request:

```sh
npm run check
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project CodexAppleWatch.xcodeproj -scheme CodexWatchApp -destination 'generic/platform=watchOS' CODE_SIGNING_ALLOWED=NO build
```

## Development Rules

- Keep OpenAI, Codex, Apple, SSH, and bridge tokens out of commits.
- Preserve the existing bridge/watch architecture unless a change clearly reduces complexity.
- Prefer app-server integration first and CLI/JSONL fallback second.
- Add or update tests when bridge behavior changes.
- Keep watchOS UI direct: projects, chats, messages, status, dictation, retry.

## Pull Request Checklist

- Tests pass.
- Watch target builds.
- Public API changes are documented in `README.md`.
- Operational behavior is documented in `docs/OPERATIONS.md` when launchd, tunnels, or nginx assumptions change.
- No local config, secrets, derived data, or user-specific runtime files are committed.
