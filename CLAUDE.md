# Practice IDE — Project Tracker

A desktop editor/compiler for Java, C++, and Python practice. Offline-first,
auto-commits every run to local Git, syncs to GitHub when online. No
autocomplete, no hover hints, no AI-assisted code — every diagnostic the
student sees comes from a real compiler run, never a predictive suggestion.
Full HLD/LLD: https://claude.ai/code/artifact/6736a84d-a3f6-4c08-b997-4ba50aaef549

The one rule that shapes every decision below: **if it happens while the
student is thinking, it's a suggestion and it's off; if it happens after they
run their own code against a real compiler, it's feedback and it's the
point of the product.**

## Status

**Current phase: 3 — terminal, command palette, local test runner. Core loop working.**

The desktop app now has: an xterm.js terminal backed by a real `node-pty`
shell (independent of the Run flow), a VS Code-style command palette
(Ctrl/Cmd+Shift+P, fuzzy-ish substring filter, arrow-key nav), and a Tests
panel that runs `workspace/tests/<language>.json` cases (stdin → expected
stdout) against the active runner and shows pass/fail per case. Verified
end-to-end: typecheck + build clean, live `npm run dev` launch with no
runtime errors.

Known gaps, honestly scoped rather than faked:
- **GitHub push doesn't happen yet.** `SyncWorker` drains the outbox and
  retries with backoff exactly as designed, but the actual `GitHubClient.push()`
  throws (`NotConfiguredGitHubClient`) until Phase 4 wires up the GitHub
  App + Octokit. Commits pile up in the outbox as `pending` — that's
  correct behavior for "not configured yet", not a bug.
- **Sandbox memory limits are best-effort.** `ulimit -v` is enforced properly
  on Linux, weak/inconsistent on macOS, and not implemented at all on
  Windows (needs a Job Object native addon) — see `packages/sandbox/src/sandbox.ts`.
  The watchdog's timeout + output cap are the real safety net right now.
- **The terminal isn't wired to the Run flow.** It's a general-purpose shell
  (matches doc §5.5's "raw REPL" parity item) — a student's `input()` call
  during a normal Run still just reads empty stdin (see `BaseRunner.run`'s
  `stdin` param), it does not go to the terminal panel. Only the Tests panel
  actually feeds specific stdin per case.
- **Test runner recompiles per case** for Java/C++ instead of compiling once
  and running N times — fine at practice scale (a handful of cases), a
  real inefficiency at anything larger.
- Phase 1's file explorer gap is still open (one fixed file per language,
  not a real multi-file workspace).

**Fixed:** compiled artifacts (`Main.class`, the C++ binary) were getting
swept up by `git add .` on every auto-commit — a real correctness bug, not
a scoped-out gap. `JavaRunner`/`CppRunner` now implement `clean(workingDir)`
(interface method, was previously a no-op stub with no way to know which
directory to clean), called after every run and every test suite, before
the commit happens. A workspace `.gitignore` (`*.class`, the binary's fixed
name, `__pycache__/`) is the backstop in case `clean()` is ever skipped —
see `getWorkspaceDir()` in `src/main/workspace.ts`. Verified directly against
the real runners (bundled with esbuild, run outside Electron): both left an
artifact right after `run()` and had it gone right after `clean()`.

**Fixed:** the command palette (Ctrl/Cmd+Shift+P) couldn't be closed —
Escape and clicking outside both called `closePalette()`, which correctly
set `paletteOverlay.hidden = true`, but nothing happened visually. Cause:
`#commandPaletteOverlay { display: flex; }` in `style.css` is an authored
rule, and an authored `display` declaration always beats the browser's
default `[hidden] { display: none }` regardless of selector specificity —
so toggling the `hidden` attribute was silently a no-op the whole time the
overlay had its own explicit `display` set. Fix: added
`#commandPaletteOverlay[hidden] { display: none; }` so the attribute is
respected again. Also made Escape-to-close a global `window` listener
(alongside the existing input-focused one) rather than depending on
`paletteInput` still having focus, as a second line of defense. Worth
remembering for any other future overlay/modal in this app — `hidden` needs
this same explicit override wherever a `display` value is also authored.

Update the checkboxes in [Roadmap](#roadmap) as work lands. Keep this section
in sync — it's the first thing to read at the start of a session to know
where we left off.

### Running it

```
npm install       # from repo root — also rebuilds better-sqlite3 for Electron's ABI, see below
npm run dev       # hot-reload dev mode (or: cd apps/desktop && npm run dev)
npm run build     # production bundle into apps/desktop/out/
npm run typecheck
```

**Dev-mode watch gotcha:** editing a file under `packages/*/src` while
`npm run dev` is already running does not reliably trigger electron-vite's
rebuild — Vite's watcher doesn't consistently follow the `node_modules`
symlink into a sibling workspace package. If you've changed runner/sandbox/
git-sync code and the app doesn't seem to reflect it, stop the dev process
(`pkill -f "electron-vite dev"`) and start it again rather than assuming
hot-reload picked it up.

**Native module gotcha:** `better-sqlite3` (outbox) and `node-pty` (terminal)
both have native bindings that must be compiled against **Electron's**
Node/V8 ABI, not your system Node — a plain `npm install` builds them
against system Node and they'll fail to load inside the app (or fail to
compile at all on very new Node versions). The root `package.json` has a
`postinstall` script (`electron-rebuild -f -w better-sqlite3,node-pty`) that
handles this automatically — if you ever see a `NODE_MODULE_VERSION`
mismatch or a `bindings` load error, re-run `npm install` from the repo root
rather than just `apps/desktop`. Separately, electron-vite's
`externalizeDepsPlugin` (see `apps/desktop/electron.vite.config.ts`) must
list `better-sqlite3` in `include` explicitly — it's a transitive dependency
(via `@practice-ide/git-sync`), not a direct one, so it doesn't get
externalized automatically, and Rollup can't bundle its dynamic `require()`
for the compiled `.node` file. (`node-pty` is a direct dependency of
`apps/desktop`, so it gets externalized without needing `include`.)

**Environment quirks (Claude Code's own terminal only, not a real machine
issue):**
- Claude Code is itself an Electron app, so its integrated terminal/Bash
  tool inherits `ELECTRON_RUN_AS_NODE=1`. Any Electron binary launched with
  that set boots as plain Node instead of a real app — `app`, `BrowserWindow`,
  and `ipcMain` all come back `undefined` from `require('electron')`, which
  looks like a crash in `ipcMain.handle(...)` at startup. Fix: run dev/build
  commands from Claude Code with that var unset, e.g.
  `env -u ELECTRON_RUN_AS_NODE npm run dev`. A normal terminal (Terminal.app,
  iTerm) won't have this var set at all.
- Electron's own postinstall (via `extract-zip`) has intermittently
  extracted only ~250KB of its ~240MB zip inside Claude Code's sandboxed
  Bash tool — silently, no error, `path.txt` just never gets written. It has
  recurred across separate installs, not a one-off. Symptom: `electron-vite dev`
  fails with `Error: Electron uninstall`. Fix (only needed inside this tool):
  extract the already-downloaded zip natively instead —
  `unzip -q ~/Library/Caches/electron/*/electron-*.zip -d node_modules/electron/dist`
  then write `node_modules/electron/path.txt` with the platform-specific
  relative path (e.g. `Electron.app/Contents/MacOS/Electron` on macOS).

## Tech stack

| Layer | Choice |
|---|---|
| Client shell | Electron + TypeScript |
| Editor core | Monaco Editor (completion/hover/signature providers never registered) |
| Terminal | xterm.js + node-pty |
| Local Git | System Git via CLI wrapper (fallback: isomorphic-git) |
| Local state | better-sqlite3 |
| GitHub sync | Octokit, behind a GitHub App |
| Packaging | electron-builder + auto-update |
| Backend (Phase 4) | Node.js (NestJS), PostgreSQL, Redis job queue |
| Cloud judge sandbox (Phase 4) | Docker-isolated workers |

## Repo structure

Monorepo, npm/pnpm workspaces. Created incrementally as each phase needs it —
don't scaffold ahead of the phase in progress.

```
compiler/
  apps/
    desktop/            # Electron app
      src/main/         # window mgmt, IPC handlers, filesystem
      src/preload/      # whitelisted IPC bridge only — no raw Node/ipcRenderer in renderer
      src/renderer/     # Monaco shell, panels, command palette
    backend/            # NestJS — Phase 4 only
  packages/
    language-runners/   # LanguageRunner interface + implementations
    sandbox/            # Sandbox.spawn(), watchdog, resource limits
    git-sync/           # LocalRepoManager, ConnectivityWatcher, SyncWorker, ConflictResolver
    shared-types/        # ExecOptions, ExecResult, CompileResult, ToolchainInfo
  docs/
  CLAUDE.md
```

## LLD → OOP mapping

This is where your Java interface/abstract-class background maps directly
onto the TypeScript code — same distinction, same reasons to reach for one
over the other:

- **`LanguageRunner` — `interface`.** Java, C++, and Python runners have
  nothing in common structurally (one compiles then runs, one just runs) —
  an interface is a pure contract, no shared state, no shared logic.
- **`BaseRunner` — `abstract class`, implements `LanguageRunner`.** Once you
  notice `detect()` (spawn a version-probe command, parse stdout) and output
  capping/timeout wiring are identical across all three runners, pull that
  into an abstract class with a template method (`run()` calls the abstract
  `doCompile()`/`doExecute()` hooks each subclass fills in). `JavaRunner`,
  `CppRunner`, `PythonRunner` extend this, not the interface directly.
- **`Sandbox` — one concrete class, platform branching internal.** Not an
  interface — there's exactly one call site (`Sandbox.spawn()`) and callers
  never need to swap implementations at runtime; the OS-specific limit code
  (`setrlimit`/cgroup vs. Job Object) is a private implementation detail.
- **`LanguageRunnerRegistry`** resolves the active runner from workspace
  language — a simple map, not a factory hierarchy; don't over-build this.

## Roadmap

### Phase 1 — Editor + local execution, Python only
Proves the no-suggestion editing model feels right before adding languages.
- [x] Electron + TS project skeleton (main / preload / renderer), `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- [x] Monaco integrated with every completion/hover/signature/inline-suggest provider explicitly disabled (see doc §5.1 config) — `src/renderer/src/main.ts`
- [x] IPC surface: `runCode`, `saveFile` (whitelisted in preload, nothing else exposed) — plus `load-file`/`git-commit`, same whitelist model
- [x] `PythonRunner`: `detect()` via `python3 --version`, `run()` via child process with `-I` isolated mode, `timeoutMs`/`maxOutputBytes` enforced — originally `src/main/pythonRunner.ts`, superseded in Phase 2 by `packages/language-runners/src/PythonRunner.ts`
- [x] Output panel streaming stdout/stderr from the child process
- [x] Manual "Save to GitHub" button — originally local-only in `src/main/gitSave.ts`, superseded in Phase 2 by `packages/git-sync`'s auto-commit-per-run (no manual button anymore); actual GitHub push still needs the GitHub App + Octokit wiring from Phase 4
- [ ] Basic file explorer, single workspace folder — currently a single fixed `main.py`, no multi-file explorer yet

### Phase 2 — Java & C++ runners, auto-commit, offline queue
- [x] `LanguageRunner` interface + `BaseRunner` abstract class (see mapping above) — `packages/language-runners/src/{LanguageRunner,BaseRunner}.ts`
- [x] `JavaRunner` (javac → class file → `java -cp`, scoped classpath) — `packages/language-runners/src/JavaRunner.ts`
- [x] `CppRunner` (g++/clang++ `-O0 -g` → binary) — `packages/language-runners/src/CppRunner.ts`; not yet done: discarding/pinning the binary post-run
- [x] `Sandbox.spawn()`: `ulimit -v` on POSIX, watchdog timeout kills process tree, `maxOutputBytes` cap — `packages/sandbox/src/{sandbox,watchdog}.ts`; Windows Job Object still unimplemented (see Status)
- [x] `LocalRepoManager`: auto-commit on every run (message format: `"Attempt #n — runs, exit <code>"`) — `packages/git-sync/src/LocalRepoManager.ts`
- [x] `outbox_commits` SQLite table + `ConnectivityWatcher` (real reachability check against `api.github.com`, not `navigator.onLine`) — `packages/git-sync/src/{Outbox,ConnectivityWatcher}.ts`
- [x] `SyncWorker`: drains outbox with backoff — `packages/git-sync/src/SyncWorker.ts`; the actual GitHub push is stubbed (`NotConfiguredGitHubClient`) until Phase 4's GitHub App/Octokit wiring exists
- [x] `ConflictResolver`: rebase first, branch to `local-conflict-<ts>` on real conflict, never touch the student's working tree — `packages/git-sync/src/ConflictResolver.ts` (not yet wired into the app's run loop — nothing calls it yet since there's no real push to conflict with)

### Phase 3 — Terminal, command palette, local test runner
- [x] xterm.js + node-pty integrated terminal — `src/main/terminal.ts` (`TerminalSession`), wired via `terminal-*` IPC; lazily started on first switch to the Terminal panel
- [x] Command palette (Ctrl/Cmd+Shift+P) — `src/renderer/src/main.ts`'s `commands` array + overlay; substring filter, arrow-key nav, Enter to run, Escape/backdrop-click to close
- [x] Testing panel: runs stdin/stdout cases locally against the active runner — `src/main/testRunner.ts`, cases read from `workspace/tests/<language>.json` (auto-created with one starter case per language); real teacher-authored cases arrive once Phase 4's assignment service exists

### Phase 4 — Teacher portal, cloud grading, analytics, exam mode
- [ ] Auth service (Athena SSO, GitHub App installation broker)
- [ ] Assignment service (exercises, starter code, hidden test cases)
- [ ] Cloud judge (Docker-isolated, one job per submission)
- [ ] Analytics/progress service + teacher portal (web)
- [ ] Exam mode sandbox profile (tighter isolation, no external clipboard-in)

## Conventions

- No comments unless explaining a non-obvious *why* (a workaround, a hidden
  constraint) — never restate what a well-named identifier already says.
- Every `ExecOptions`-driven call must set `timeoutMs` and `maxOutputBytes`
  explicitly — no runner is allowed to run student code unbounded.
- Commit messages for auto-commits follow `"Attempt #n — runs, exit <code>"`
  per doc §6; keep this format since the teacher-facing replay view depends
  on parsing it later.
- Don't build the Phase 4 cloud pieces or the strong-isolation
  (Docker/Firecracker) sandbox escalation path until the phases before them
  are done — they're explicitly deferred in the doc, not MVP.
