# Halyard

A native desktop shell for [opencode](https://opencode.ai) — chat, session
tabs, subagents, diffs and settings, with the agent's own server managed for
you.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/lockup-on-dark.svg">
    <img src="docs/lockup-on-light.svg" alt="Halyard" width="360">
  </picture>
</p>

```
                      ████████▓▓▓▓▓▓
     ▄▄▄▄▄███▓        ████████▓▓▓▓▓▓
▄██████▓▓▓▓▓▓▓        ████████▓▓▓▓▓▓
███████▓▓▓▓▓▓▓        ████████▓▓▓▓▓▓
███████▓▓▓▓▓▓▓▄▄▄▄████▓▓▓▓▓▓▓▓▓▓▓▓▓▓
███████▓███████▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
███████████████▓▓▓▓▓▓▓▓▓▓▓▓█▓▓▓▓▓▓▓
███████████████▓▓▓▀▀▀▀███████▓▓▓▓▓▓▓
███████▓▓▓▓▓▓▓        ██████▓▓▓▓▓▓▓▓
███████▓▓▓▓▓▓▓        ▓███▓▓▓▓▓▓▓▓▓▀
███████▓▓▓▓▓▓▓        ▓▓▓▓▀▀▀▀
█████▓▓▓▓▓▓▓▓▓
▓█▓▓▓▓▓▓▓▀▀▀▀
```

## The mark

An isometric **H** drawn from sheared parallelograms — a line that becomes a
letter, a symbol and a sense of direction. Each stroke splits along its centre
into two facets meeting at a fold, so it reads as a folded ribbon rather than a
flat letter, and still reads as an H when both facets collapse to one colour.

## The wordmark

Custom geometric lettering, not a typeface — every horizontal band is cut so its
top and bottom edges rise to the right at the mark's own angle, and no other
angle is allowed anywhere in the word. The word itself stays flat and level so
it holds together at the eleven pixels the title bar gives it.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-on-dark.svg">
    <img src="docs/wordmark-on-light.svg" alt="HALYARD" width="300">
  </picture>
</p>

| | |
|---|---|
| ![app icon, dark](docs/app-icon-dark.svg) | ![app icon, light](docs/app-icon-light.svg) |

| Colour | Hex | Role |
|---|---|---|
| Graphite | `#17191D` | Surface, and the mark in light mode |
| Seafoam mint | `#83E1C1` | Accent |
| Soft white | `#F4F4F0` | Ink, and the mark on graphite |

Both are defined once as geometry — [`tools/logo.py`](tools/logo.py) for the
symbol, [`tools/wordmark.py`](tools/wordmark.py) for the word — and everything
else is generated from them: app icons, tray icon, the lockups, and the ASCII
form above, which is the mark sampled off the vector rather than drawn by hand.
Run `bash tools/icons.sh` after changing either and commit the result under
`src-tauri/icons`.


## What it does

- **Sessions** — tabs, branching, forking, sharing, export and import through
  opencode's own CLI
- **Subagents** — delegated runs appear as nested sessions under their parent
- **Diffs** — per-file review, inline with the tool that made the change
- **Plan** — the agent's todo list, live above the composer
- **Permissions and questions** — answered inline, without leaving the thread
- **Tray** — close to tray, notifications when a turn finishes, taskbar badge
- **Settings** — providers, models, agents, MCP servers, skills and opencode's
  own config, all live

## Running it

```bash
pnpm install
pnpm tauri dev
```

You need a Rust toolchain, and `opencode` on `PATH` (or set a path in Settings).

```bash
pnpm typecheck     # frontend
pnpm vitest run    # frontend tests
cd src-tauri && cargo test
```

## Platforms

Linux and Windows. The server is terminated with SIGTERM on Unix and
`taskkill /T` on Windows, so the child never outlives the window.

## Licence

MIT.
