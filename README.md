<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/lockup-on-dark.svg">
  <img src="docs/lockup-on-light.svg" alt="Halyard" width="340">
</picture>

# Halyard

**A native desktop shell for [opencode](https://opencode.ai).**

Chat, session tabs, subagents, diffs and settings — with opencode's own server
started, watched and stopped for you.

[![CI](https://img.shields.io/github/actions/workflow/status/12errh/halyard/ci.yml?branch=main&style=flat-square&labelColor=17191D&label=CI)](https://github.com/12errh/halyard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-83E1C1?style=flat-square&labelColor=17191D&logoColor=17191D)](LICENSE)
[![Platforms](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-83E1C1?style=flat-square&labelColor=17191D)](https://tauri.app)
[![Tauri](https://img.shields.io/badge/tauri-2-fc6259?style=flat-square&labelColor=17191D&logo=tauri&logoColor=fc6259)](https://tauri.app)
[![React](https://img.shields.io/badge/react-19-61dafb?style=flat-square&labelColor=17191D&logo=react&logoColor=61dafb)](https://react.dev)
[![Rust](https://img.shields.io/badge/rust-2024-orange?style=flat-square&labelColor=17191D&logo=rust&logoColor=orange)](https://www.rust-lang.org)

</div>

---

![Halyard on the desktop](docs/home.png)

## What it does

- **Sessions** — tabs, branching, forking, sharing, export and import through
  opencode's own CLI, scoped to the project you have open
- **Subagents** — delegated runs appear as nested sessions under their parent
- **Diffs** — per-file review, inline with the tool that made the change
- **Plan** — the agent's todo list, live above the composer
- **Skills** — search and attach several at once, then send them as commands
- **Permissions and questions** — answered inline, without leaving the thread
- **Context meter** — the live prompt window, not a lifetime token tally
- **Tray** — close to tray, notifications when a turn finishes, taskbar badge
- **Settings** — providers, models, agents, MCP servers, skills and opencode's
  own config, all live

## Getting started

You need [Node](https://nodejs.org), [pnpm](https://pnpm.io), a Rust
toolchain, and `opencode` on your `PATH` — or a path to it in Settings.

```bash
git clone https://github.com/12errh/halyard.git
cd halyard
pnpm install
pnpm tauri dev
```

Build a distributable bundle:

```bash
pnpm tauri build
```

## Testing

```bash
pnpm verify   # typecheck, frontend tests, Rust tests, production build
pnpm smoke    # the fast loop: shell smoke test + architecture guard
```

`pnpm verify` is what CI runs on every push. See
[docs/testing.md](docs/testing.md) for the layers and the rules behind them —
in short, unit tests do not catch a component that crashes on mount, so
something mounts the real shell.

## How it fits together

| Layer | What lives there |
|---|---|
| `src-tauri/` | Rust. Spawns and supervises the opencode server, tray, notifications, taskbar attention, and the settings file |
| `src/lib/opencode/` | The opencode client: HTTP, the SSE stream, and the pure thread reducer |
| `src/state/` | Zustand stores, one per concern — sessions, threads, permissions, models, settings |
| `src/components/` | The UI: `shell/` for the window, `chat/` for the conversation |
| `tools/` | The mark and wordmark as geometry; `bash tools/icons.sh` regenerates every icon and lockup from them |

The rule that shapes most of `src/lib/opencode/`: streaming correctness is
derived as a pure function of `(state, event)` with no I/O and no React, so it
can be tested exhaustively instead of watched.

## Updates

AppImage and NSIS installs update themselves: the release is downloaded,
verified against a signing key compiled into the app, installed, and Halyard
relaunches. Windows installs per-user, so an update never asks for
administrator rights.

`.deb` and `.rpm` cannot do that — replacing a system package means writing to
`/usr`, which needs root. Those installs update through the package manager,
which asks for your password the way you expect. Halyard detects which kind it
is and says so rather than offering a control that would fail.

```sh
# In Settings → General → Check for updates
```

Releases are built by pushing a `v*` tag. See
[docs/releases.md](docs/releases.md) for the signing setup, the per-platform
matrix, and how to verify a manifest by hand.

## Platforms

Linux and Windows. The server is terminated with SIGTERM on Unix and
`taskkill /T` on Windows, so the child process never outlives the window.

## Licence

MIT — see [LICENSE](LICENSE).
