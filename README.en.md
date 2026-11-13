# dsh-auto-team

[简体中文](./README.md) · [English](./README.en.md)

Turn the current DeepSeek Harness session into a team lead: the goal becomes a **dependency-aware task graph**, roles **dispatch in parallel** to resumable members, every completion must pass a **quality gate**, and the whole run stays visible and editable from the composer switch and the right-side panel.

- Version & baseline: `dsh-auto-team@0.2.2` (`package.json`); on 2026-11-13, `pnpm test` = **1257 pass / 0 fail / 0 skipped** (exit 0, ~6–8s)
- Compatibility: Node `>=22.18`, DSH `>=0.2.1-alpha.2 <0.3.0`; verified on host `0.2.2-rc.2`
- Commands below run inside the repo; copy this line first (works from any subdirectory):

```bash
export REPO="$(git rev-parse --show-toplevel)" && cd "$REPO"
```

![Auto team: main conversation plus the right-side panel (left navigation cropped)](docs/images/panel-overview.png)

## What it solves

- **Tasks never jump the queue**: the goal is split into a task graph; downstream tasks stay `blocked` until their dependencies pass, and work goes to resumable sub-agents by role (product / design / architecture / full-stack / QA plus custom roles).
- **Parallel without collisions**: write scopes (`writeScopes`) are mutually exclusive, so only one task edits a given slice of files at a time; concurrency defaults to 3, is configurable 1..8, and is clamped by the host limit.
- **"Done" does not count**: every task carries an executable acceptance command and only `exit 0` flips it to done; failures go back for rework with the evidence sent to the original member.
- **Changed requirements do not restart the run**: revise, add, or cancel tasks inside the same run while keeping finished work; token and duration numbers are real — when unavailable they read "not available", with **no zeros and no estimates**.

## 30-second tour

1. **Install** (this machine uses profile `desktop`; `dsh` is not on PATH):

```bash
cd "$REPO" && pnpm install
cd "$REPO" && pnpm build
cd ~/.dsh/profiles/desktop
pnpm add "file:$REPO"
grep -n '"dsh-auto-team"' package.json
```

If `grep` shows only 1 line (no `dsh.profile.bundles` entry), add `"dsh-auto-team"` to that array by hand, then restart.

2. **Turn it on**: restart the host and refresh the GUI. The "auto team" capsule on the **left** of the composer is the per-session master switch and is off by default. It is live only when all four are present: capsule, session-header button, right-side tab, settings section.

3. **Dispatch the first task and accept it**: tell the lead the goal (e.g. "split this requirement into tasks and dispatch the team"). The lead calls `auto_team_plan` — every task needs a `roleId` and an **executable** `acceptance` (a blank one rejects the whole batch), and a saved plan **auto-dispatches**; after a member reports back, the lead session with the switch on (or that member) submits a receipt → `auto_team_receipt` actually runs the gate, only `exit 0` becomes done, failures turn into `rework` with evidence sent back and downstream tasks stay `blocked`.

Rollback is three commands (the last line should print `0`):

```bash
cd ~/.dsh/profiles/desktop
pnpm remove dsh-auto-team
grep -c '"dsh-auto-team"' package.json
```

## Capabilities

| Capability | Entry point | Notes |
| --- | --- | --- |
| Enable / disable (per session, default off) | Capsule on the left of the composer | `conversation.input.left`; when off every tool answers "not enabled" |
| Right-side panel (tasks / history / memory) | "Auto team" tab in the right sidebar | keyed slot: `sidebar.right.pane.tab` + `.title`, and it must also register into `sidebarRightTabs` |
| Project library / memory | Left sidebar section + full-page main area; panel "Memory" (project track), "Global" (public track) | Falls back to an inline library if the main-area registration fails; two-track md, also via `auto_team_memory` |
| Settings / roles / skills | "Auto team" settings section | 6 parameters; 11 built-in roles + 12 skills, editable but not deletable (skills can be restored) |
| Lead tools | Callable in any session with the switch on | 8 tools, see the next line |

8 tools: `auto_team_plan` (save a plan) → `auto_team_dispatch` (confirm dispatch) form the backbone, joined by `auto_team_add_tasks` (append to the same run), `auto_team_status` (read-only snapshot), `auto_team_message` (direct message, resumable), `auto_team_receipt` (run the gate, the **only** completion path), `auto_team_memory` (two-track memory), and `auto_team_role` (roles); when disabled all of them return the same "auto team is not enabled…" message. To revise a requirement pass `revise: true` so it **merges into the same run** (without it a new run is always created; the lead decides), see [r21 merge & replan](docs/teamflow/2026-11-10-r21-merge-replan/QA-REPORT.md); gate semantics, the two memory tracks, and every tool return shape are in [ARCHITECTURE.md](docs/teamflow/architecture/ARCHITECTURE.md) and `src/host/tools.ts`.

## Screenshots

Three screenshots from a real run (macOS desktop, 1728×1084, a 5-task / 5-member run on 2026-11-10):

![Tasks page: progress, role member cards, gate conclusions](docs/images/panel-tasks.png)

One screen shows it all: run header (`plan 5 · members 5 · concurrency 0/3 · terminated`), the usage block, member cards grouped by role, the completion ring, and per-task gate conclusions. The "requirement updated" capsule marks a run that was revised.

![Dependency graph: solid = done, dashed = unfinished](docs/images/panel-flow.png)

Every task on the graph carries its token count and duration; `t5` reads "not available" because that run genuinely had no readable usage source — not because it was written as 0.

![The auto-team switch at the bottom-left of the composer](docs/images/entry.png)

The capsule is the **per-session** master switch (off means no members are ever spawned silently); the left "Auto team" section is the cross-run project library.

Source files of all four images: [panel overview](docs/images/panel-overview.png), [tasks page](docs/images/panel-tasks.png), [dependency graph](docs/images/panel-flow.png), [composer switch](docs/images/entry.png).

## Compatibility and version support

| Component | Required / verified | Evidence |
| --- | --- | --- |
| Node.js | `>=22.18` (declared); measured `v26.11.1` here | `package.json` `engines.node`; `node -v` |
| DSH host | `>=0.2.1-alpha.2 <0.3.0` (declared); verified on `0.2.2-rc.2` (macOS desktop) | `package.json` `engines.dsh`; `CFBundleShortVersionString` |
| Member API boundary | **since 0.2.2-rc.2** member capabilities live in `subagents`; the old `agentTeams` only keeps task-book methods | `HostSubagents` in `src/host/adapters.ts` |
| Dual-path compatibility | Per-capability `typeof` probing: new API first, old API as fallback | `src/host/adapters.ts`; `test/adapters.test.ts` |

**What the boundary means**: the host comment says *teammates are subagents, so subagent limits and inbox delivery apply*. When creating a member, `provider` is a **subagent provider name** (only `spawn` exists here) and per-role models go through `agentOptions`, never `provider`; a wrong value makes every dispatch fail. Both naming traps are in [HOST-EVENTS.md](docs/teamflow/architecture/HOST-EVENTS.md) §3.3.

**Honest boundary**: only `0.2.2-rc.2` is installed here, so the old `0.2.1-alpha.2 ~ 0.2.2-rc.1` path has unit-test stubs but no real-host regression; `engines.dsh` is a declared range, not a per-version verification.

```bash
node -v
node -e "const p=require('./package.json');console.log(p.version,p.engines.node,p.engines.dsh)"
```

## Where data lands

| Path | Contents |
| --- | --- |
| `~/.dsh/auto-team/runs/` | Run state: plan, tasks, member bindings, gate evidence, `termination` |
| `~/.dsh/auto-team/sessions.json` | Per-session switch |
| `~/.dsh/auto-team/settings.json` | 6 parameters (concurrency, memory budget, stall threshold, rework limit, gate timeout, lead model) |
| `~/.dsh/auto-team/roles/<id>.json`, `~/.dsh/auto-team/skills/<id>.md` | Roles and skills (seeded on first start; editable, not deletable) |
| `~/.dsh/auto-team/memory/public/`, `<workspace>/.auto-team/memory/` | Public (cross-project) and project memory; the project `workspace` is resolved from the real run project and reports `degraded/degradeReason` when it cannot be resolved |
| `<session workspace>/.auto-team/artifacts/<taskId>.log` | Full gate log (relative paths inside acceptance commands are usable) |
| `~/.dsh/auto-team/deviations.jsonl` | Audit trail for files the lead wrote itself (append-only) |

Inspect what landed, and clean up historical data (backfill is idempotent; curation starts as a dry run):

```bash
ls ~/.dsh/auto-team/
ls ~/.dsh/auto-team/runs/ | tail -5
ls .auto-team/memory/
node src/host/memory/backfill-cli.ts --dry-run
node src/host/memory/curate-cli.ts --track project --dir "$(pwd)/.auto-team/memory" --dry-run
```

## Troubleshooting

The three most common cases only; the rest are in [ARCHITECTURE.md](docs/teamflow/architecture/ARCHITECTURE.md) §9 and [memory.md](docs/teamflow/memory.md).

| Symptom | Real cause | Fix |
| --- | --- | --- |
| Every tool answers "not enabled" | Tools identify the session via `exec.agent.id`, the panel records the switch on the real session | Flip the switch in the **same session**; never fall back to `'current'` |
| Build is green but the right-side tab never appears | A keyed slot without `key`, or the tab was not registered into `sidebarRightTabs` | Both keys and `register({id})` must match; rerun `pnpm test` after the fix |
| Every panel request is `HTTP 404` | `webServer` is not active yet at `apply` time | This repo registers in two stages (try once + `ctx.inject(['webServer'])`); in DevTools `GET /api/auto-team/snapshot?sessionId=…` should be 200 and include `roles` |

```bash
grep -rn 'sidebarRightTabs' src/client/slots.ts
grep -rn 'ctx.get' src/host/adapters.ts | wc -l
node --test test/r29-packaging.test.ts
```

## Known limitations

- **A member session can only see / submit its own task**, and member self-service is also gated by the switch: when the lead session that owns the run is off, `status` and `receipt` both answer "not enabled".
- **Configured concurrency may be clamped by the host**: setting 6 may still run 3; the setting is a request, and the snapshot carries requested / clamped markers.
- **The left sidebar section and full-page project library are not verified on a real host (U2)**: a failed registration falls back to the inline panel library, so the right panel is unaffected.
- **Pause only stops dispatch, receipts, and stall detection**: running members keep writing files; interrupt that member in the panel to stop it immediately; a saved plan auto-dispatches with no "review first" switch, so pause before confirming if you want to review.
- **Usage on old runs may stay "not available" forever**: those runs ended on older builds and their sessions are gone; the memory page token count carries `≈` because it is estimated from characters (about "chars / 2"), not provider-reported.

## Development and verification (must be green before committing)

```bash
cd "$REPO" && pnpm typecheck
cd "$REPO" && pnpm test
cd "$REPO" && pnpm build
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
npm pack --dry-run --cache /tmp/npm-pack-cache
```

Reproduce the whole chain in one line:

```bash
export REPO="$(git rev-parse --show-toplevel)" && cd "$REPO" && pnpm typecheck && pnpm test && pnpm build && node --input-type=module -e "await import('./lib/index.js')" && node --input-type=module -e "await import('./lib/client.js')" && npm pack --dry-run --cache /tmp/npm-pack-cache
```

- Baseline (measured 2026-11-13): `pnpm test` **1257 pass / 0 fail / 0 skipped** (~6–8s); `lib/index.js` **637.90 kB**, `lib/client.js` **603.68 kB**; `npm pack --dry-run` lists 8 files (`package.json`, both READMEs, `cordis.patch.yml`, both `lib/` bundles, `locale/en.json`, `locale/zh.json`).
- Numbers drift with the implementation: rerun the commands above for current values instead of comparing this table to CI output; package size also changes with the README size itself.
- Do not bypass: `lib/` must be committed (it is the `pnpm add file:` install source); local imports carry the `.ts` extension; host and client never import each other and only talk over `GET/POST /api/auto-team`; host service access is concentrated in `src/host/adapters.ts`.

## Documentation

| What you need | Where |
| --- | --- |
| Architecture, module contracts, data flow, build / test / CI, unfinished list | [ARCHITECTURE.md](docs/teamflow/architecture/ARCHITECTURE.md) |
| Host events, UI slots, real-host verification | [HOST-EVENTS.md](docs/teamflow/architecture/HOST-EVENTS.md), [UI-SLOTS.md](docs/teamflow/architecture/UI-SLOTS.md), [REAL-HOST-VERIFY.md](docs/teamflow/architecture/REAL-HOST-VERIFY.md) |
| Team conventions and pitfalls | [memory.md](docs/teamflow/memory.md) |
| Revising one requirement: merge, cancel, stopping states | [r21 merge & replan](docs/teamflow/2026-11-10-r21-merge-replan/QA-REPORT.md) |
| Per-requirement task folders (newest first = iteration history) | [docs/teamflow/](docs/teamflow/) |
| Collaboration rules and doc index | [AGENTS.md](AGENTS.md) |

### Changelog (last 3 entries; full history in `git log` and [docs/teamflow/](docs/teamflow/))

- **2026-11-13 · v0.2.2 reachable panel & awaiting receipt**: clicking a role card, task row or flow node jumps straight to that member's session (`ctx.uiWorkspace.openSession`; no member or an unreachable session gets a stated reason instead of a silent no-op); when a member ends its turn without submitting a receipt the host records `silentFinish`, the task row and member page show 「待回执」 and the captain is notified exactly once — inform only, never auto-complete or auto-rework; the "not closed" badge appears only once it is confirmed that no member is alive. Verified by `pnpm test` (1257 cases, including `test/r34-silent-finish-wire.test.ts`).
- **2026-11-13 · Member self-service**: `auto_team_status` / `auto_team_receipt` now work inside member sessions — they only see their own task, a foreign `taskId` returns `FORBIDDEN`, the gate still runs through the same host path, and both tools refuse identically when the switch is off. Verified by `pnpm test` (including the 12 cases in `test/r30-member-self-service.test.ts`).
- **2026-11-13 · Packaging-manifest regression**: added `test/r29-packaging.test.ts` (6 cases) — valid semver `version`, `engines` matching both READMEs word for word, `exports` / `files` including locale, equal h2 and image sets across languages, and a real `npm pack` manifest with 7 required files. Why: these were synced by hand, so drift stayed green everywhere.
