# herdr-omo-toolbox

A [herdr](https://herdr.dev) plugin for running [OmO](https://github.com/code-yeongyu/oh-my-openagent) in herdr: live agents and tasks boards, automatic tab titles with agent icons, status glyphs, and MRU alt-tab.

## Install

```sh
herdr plugin install rob-64/herdr-omo-toolbox
```

This replaces the older `herdr-omo-agents` plugin — uninstall it first if you had it:

```sh
herdr plugin uninstall herdr-omo-agents
```

It needs `bun` or `node` 18+ on `PATH`. Nothing is built or downloaded.

Having a coding agent install it? Point it at [agents-install.md](agents-install.md): it covers the install, the OmO `/agents-board` extension, and keybindings.

## Agents board

Shows every OmO subagent and DAG run in one live board: status, agent, task, model, elapsed time, and what each running agent is doing right now.

```
 OmO Agents  GLOBAL   Agents  DAG   filter:today                 ⠋1 ✔238 ✖1
──────────────────────────────────────────────────────────────────────────────
▍w18:p1 · Update uas-normalize to 7.5.0  󰄬 idle   1 running · 3 done
  ⠙ plan-reviewer    High-accuracy review of tas-github-ci-parity…    9m04s
     └ [grep …/workflows/build-and-publish.yml] I'm confirming the nexus-ur…
  ✔ plan-reviewer    High-accuracy review of tas-github-ci-parity…   10m58s
  ✔ plan-consultant  Gap-analyze TAS GitHub CI parity plan            7m55s
```

### Open it

| Action | What it does |
| --- | --- |
| `herdr-omo-toolbox.open` | Popup over the current pane |
| `herdr-omo-toolbox.open-split` | Split to the right of the current pane |
| `herdr-omo-toolbox.open-tab` | Its own tab |

Bind one to a key in `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+o"
type = "plugin_action"
command = "herdr-omo-toolbox.open"
description = "OmO agents board"
```

Or run it from a shell: `herdr plugin action invoke herdr-omo-toolbox.open`.

### Live subagent output

On a **subagent** row (Agents view, Tasks tree, or a DAG node with a task id), press **Enter** or **click the row again** to open a read-only, live-tailing transcript inside the board — like `tail -f` on the session log. The viewer never writes to OmO state (it does not call `omo --session`).

| Key | Action |
| --- | --- |
| `j` `k` / ↑ ↓ / wheel | Scroll the transcript |
| `PgUp` / `PgDn` / `Space` | Page up / down |
| `g` / `G` | Top / bottom (`G` re-enables **following**) |
| `t` | Show all thinking (default: first 2 lines) |
| `e` | Expand the task prompt and tool results |
| `p` | Focus the owning session's herdr pane |
| `O` | Open this viewer in a new split (`OMO_BOARD_FOLLOW=<taskId>`) |
| `Esc` / `←` / `h` | Back to the board (or `q` when opened via split env) |

Session header rows keep the old behavior: click toggles session scope; **Enter** focuses that session's pane. Use **`p`** on any row to jump to the pane (the old Enter behavior for subagent rows).

**Mouse:** click **◂ back** to return to the board; wheel scrolls.

## Tasks board

Shows OmO **todo** lists (the `todo` tool) as a **tree** per session: main-session phases and items, nested **subagent** rows (with their own todo lists), tree guides, and fold/unfold. Scope and session cycling work like the agents board (`g`, `[` `]`). Press **`f`** to cycle the **status** filter (`all`, `open`, in progress, pending, completed, abandoned). Press **`v`** or **Tab** to switch **Agents** / **DAG** / **Tasks**.

```
 OmO Tasks  GLOBAL   Agents  DAG  Tasks   filter:today   status:all
──────────────────────────────────────────────────────────────────
▍w1:p1 · Update BFF CI  ⠙ working  ███████░░░░░ 7/12 done · 2 subagents (1 running)  2m ago
├ ▾ Setup  3/3
├ ▾ Wave 1  2/6
│ ├ ◐ Publish proto jar
│ └ ○ Resolve c2-services-common
├ ▾ ⠙ plan-reviewer · High-accuracy review of CI parity plan        4/9   9m04s
│ └ ▾ Review  4/9
│   └ ◐ Check workflows
└ ▸ ✔ explore · Find workflow files                                 3/3   1m10s
```

Completed phases and finished subagents start **folded** (`▸`); press **Space** on a row (or click **▸/▾**) to toggle. **`→`** / **`l`** expand, **`←`** / **`h`** collapse (on a leaf, collapse jumps to the parent). **`z`** folds all nodes in scope; **`Z`** expands all. Subagent rows support the same **Enter** / **click-again** live output, **`p`**, and **`O`** keys as the agents board.

### Open it

| Action | What it does |
| --- | --- |
| `herdr-omo-toolbox.open-tasks` | Popup over the current pane |
| `herdr-omo-toolbox.open-tasks-split` | Split to the right of the current pane |
| `herdr-omo-toolbox.open-tasks-tab` | Its own tab |

Or from OmO: `/agents-board [mode]`. Switch to the **Tasks** view with `v` or `Tab`, or use the `open-tasks*` actions above.

Todo data is read incrementally from OmO session transcripts: main sessions under `~/.omo/agent/sessions/`, and subagent transcripts from each task's `host_session.session_path` (or `children/<task>/sessions/<task>/`). The board only loads todos while the **Tasks** view is active.

### OmO extension

`omo_extensions/herdr-omo-toolbox.js` is an OmO extension that adds `/agents-board [mode]` (with tab completion for the mode) and `/rename-tab <name>`:

| Mode | Opens |
| --- | --- |
| `split` (default) | Split to the right, focus stays in OmO |
| `split-down` | Split below, focus stays in OmO |
| `overlay` | Zoomed over the current pane until you press `q` |
| `popup` | Floating window over everything |
| `zoomed` | New pane, zoomed to fill the tab |
| `tab` | Its own tab |
| `help` | Lists the modes |

`/rename-tab <name>` renames the herdr tab this OmO session is in. After that, the tab watcher leaves that tab alone and stops auto-renaming it.

Install it, then start a new OmO session or run `/reload`:

```sh
cp omo_extensions/herdr-omo-toolbox.js ~/.omo/agent/extensions/herdr-omo-toolbox.js
```

Remove the old `herdr-omo-agents.js` extension if you had it installed.

### Keys

| Key | Action |
| --- | --- |
| `g` | Toggle **global** (every OmO session) / **session** (the OmO session in the pane you opened the board from) |
| `s` | Show the selected row's session |
| `[` `]` | Previous / next session |
| `v` or `Tab` | Cycle **Agents** / **DAG** / **Tasks** view |
| `a` | Cycle filter: `active` → `today` → `all` |
| `f` | Cycle status filter (Tasks view): `all` → `open` → … |
| `Space` | Toggle fold on selected tree row (Tasks view only; elsewhere page down) |
| `h` `l` / ← → | Collapse / expand selected foldable row (Tasks view) |
| `z` / `Z` | Fold all / expand all in scope (Tasks view) |
| `j` `k` / ↑ ↓ / wheel | Move selection |
| `Enter` | Subagent row: **live output**; session header: focus that session's pane |
| `p` | Focus the herdr pane for the selected row's session |
| `O` | Open live output for the selected subagent in a split pane |
| `r` | Refresh now |
| `q` / `Esc` | Close |

It opens in **global** scope, **Agents** view, filter **active**.

**Mouse:** click a row to select it; click a **subagent** row again for live output. Click a session header to open that session and click it again to go back to global. In the header, click `GLOBAL`/`SESSION`, `Agents`/`DAG`/`Tasks`, `filter:`, or `status:` to switch them.

The session in the herdr pane you last focused is highlighted.

### What it shows

- **Agents view**: one block per OmO session, labelled with its herdr pane and title. Open OmO panes are listed even when they have no subagents, so you can see which ones are working or waiting for input. Each subagent shows its status, agent or category, task summary, model, elapsed time, and turns/tool calls. Running subagents get a live line with the current tool call and the latest thought. In global scope, each session lists at most 5 finished subagents; `s` shows the rest.
- **DAG view**: each `mass ulw` / DAG run with a progress bar, then its nodes by stage with dependencies (`← build`), route, attempt, and elapsed time. Failed nodes show their error.
- **Stale detection**: a subagent still marked running whose host process is gone is flagged `!`.

### How it works

The board only reads files; it never writes to OmO state.

- Subagents: `~/.omo/agent/projects/*/senpi-task/tasks/*.json` (plus stores listed in `~/.omo/agent/rpc/task-stores.json`).
- DAG runs: `<store>/dag/runs/*.json`.
- Live activity: the tail of each running subagent's child session transcript.
- Pane ↔ session: the OmO process in each herdr pane (`HERDR_PANE_ID` in its environment) is matched to the session that owns its RPC shard (`~/.omo/agent/rpc/shards/*.meta.json`).

Set `OMO_AGENTS_DIR` to read a different OmO agent directory.

### CLI

`bin/agents-board` also runs outside herdr:

```sh
bin/agents-board --once --scope global --view dag --filter all --width 140
bin/agents-board --once --follow st_01a18a30 --width 110 --height 40
bin/agents-board --json --follow st_01a18a30
bin/agents-board --once --view tasks --filter today --status open
bin/agents-board --json --scope session --session-pane w11:p1
bin/agents-board --json --view tasks
```

## Agent status

When OmO runs inside a herdr pane, `omo_extensions/herdr-omo-toolbox-status.js` reports agent state back to herdr so the agent list shows whether OmO is idle, working, or blocked. **Background subagent tasks** (`running` or `pending`) count as **working**, so the spinner keeps going while OmO waits on subagents.

The session name becomes the reported title when OmO has one. Install both extensions (new OmO session or `/reload`):

```sh
cp omo_extensions/*.js ~/.omo/agent/extensions/
```

This replaces the third-party **`omo-herdr`** npm package — do not run both. If you still have it: `omo remove npm:omo-herdr`.

## Tab titles, icons, alt-tab

Makes tabs usable with OmO agents:

- **Automatic tab titles** from each agent's task title (not the live terminal title). Before the agent has a task title, the tab shows the agent's folder name (last segment of its working directory).
- **Icons and status** in the tab bar, e.g. `󰏉 󱎖 Fix merge conflicts PR 7`.
- **Last tab** action — MRU alt-tab across workspaces.

Requires a **Nerd Font** (e.g. Hack Nerd Font Mono) for agent and status glyphs (Material Design icons in the Nerd Font PUA, vertically aligned with the agent icon).

On startup Herdr runs `tabs ensure`, which starts a background watcher. You can also use the **Start tab titles** / **Stop tab titles** plugin actions (`herdr-omo-toolbox.tabs-start`, `herdr-omo-toolbox.tabs-stop`).

### Keybinding (last tab)

Add to your Herdr config:

```toml
[[keys.command]]
key = "prefix+tab"
type = "plugin_action"
command = "herdr-omo-toolbox.last-tab"
description = "last tab"
```

Then reload:

```bash
herdr server reload-config
```

Pressing the binding jumps to the previously focused tab; repeated presses toggle between the last two tabs (even across workspaces).

### Config

Optional file: `HERDR_PLUGIN_CONFIG_DIR/config.json` (typically under your Herdr plugin config tree):

```json
{
  "icons": { "omo": "󰏉" },
  "status": true,
  "max_title": 32
}
```

- `icons` — per-agent Nerd Font glyphs; merge over defaults. Set `"icons": false` to disable icons.
- `status` — show Nerd Font status glyphs (e.g. 󱎖 working, 󰻂 blocked, 󰝥 done, 󰄬 idle, 󰝦 unknown). Set `false` to hide them.
- `max_title` — max characters for the task title (truncated with `…`).

Tab watcher state (MRU, owned labels, watcher PID) lives under `$HERDR_PLUGIN_STATE_DIR/tabs/`.

### What gets renamed

The watcher only claims tabs that look unnamed (numeric labels like `1`), stale `OmO - …` terminal titles, or tabs it already owns. Custom tab names you set yourself are left alone. If you rename a tab the plugin had named, that tab is released and never auto-renamed again.

When the watcher stops, it strips icon/status prefixes from tabs it owned and restores plain titles.

### herdr-bar

This plugin's description includes **Automatic tab titles**, so **herdr-bar** detects it and stops its own tab renaming — the two plugins do not fight.

## Layout

- `board/` — live agents and tasks board (`main.mjs`, data/render)
- `omo_extensions/` — OmO extensions: `/agents-board`, `/rename-tab`, and agent status
- `tabs/` — automatic tab titles, icons, MRU state, and tests
- `bin/agents-board` — launcher for the board
- `bin/tabs` — launcher for the tab watcher and actions
- `scripts/check-runtime.sh` — plugin build check (bun or node 18+)

## License

MIT
