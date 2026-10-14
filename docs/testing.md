# Testing strategy

Run everything before calling a change done:

```bash
pnpm verify
```

That is `typecheck` → `vitest run` → `cargo test` → `vite build`. If you only
want the fast inner loop while iterating on the shell, `pnpm smoke`.

## The layers, and what each one is for

**Unit** — pure functions and stores in isolation: `src/lib/**`, `src/state/**`.
Fast, and they pin down behaviour precisely.

**Component** — a component rendered with its collaborators, in jsdom:
`src/components/**`. This is where most of the suite lives.

**Smoke** — the *real* shell, mounted: `src/components/shell/app-shell.test.tsx`.
`AppShell` wires the server lifecycle, SSE, every store and every child. It is
the only test that renders the app the way a person does.

**Architecture guard** — `src/test/store-selectors.test.ts` reads the source
instead of running it, and fails on patterns that are legal to write and wrong to
ship.

## Why the smoke test exists

The suite was 449 green tests while the app crashed on launch with
`Maximum update depth exceeded`. Nothing was wrong with any of those tests —
`AppShell` had never been mounted by any of them, and a component cannot break
on mount without being mounted.

So: mount it. It now catches that class of failure directly, and it fails
loudly on the exact React messages rather than trusting that "it rendered" meant
"it behaved".

Two rules that came out of building it:

- **Never silence `console.error` to make a test pass.** Capture and call
  through. Muting it turned a real boot failure into an unexplained timeout.
- **Wait on what a person sees**, not on store internals. The tests poll for the
  `opencode <version>` badge, which only renders once the server is up.

## Why the guard exists

`useStore((s) => ({ ... }))` allocates a new object every render.
`useSyncExternalStore` sees a new snapshot, re-renders, allocates again, and
React tears the tree down. The guard reads every `.ts`/`.tsx` file and fails on
any selector that allocates — object literals, array literals, `.map()`,
`.filter()`, `.slice()`, `new Set`, `new Map`, `JSON.parse`, `Object.keys`.

It covers files with no tests at all, which is the point: the crash existed in a
file nothing was reading.

**Both new tests were verified by reintroducing the bug and confirming they
fail.** A guard that has never failed is not a guard. Do the same for anything
new in this file.

## Before adding a feature

- Fixing a bug? Write the test that fails first, watch it fail, then fix.
- Adding a field to a store that a component selects? The guard already
  enforces the stable-selector rule; do not work around it.
- Touching boot, SSE, or the shell layout? `pnpm smoke` is the minimum. Mount
  coverage is what the unit layer cannot give you.
