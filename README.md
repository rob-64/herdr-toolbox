# herdr-omo-agents

A [herdr](https://herdr.dev) plugin that shows every [OmO](https://github.com/code-yeongyu/oh-my-openagent) subagent and DAG run in one live board: status, agent, task, model, elapsed time, and what each running agent is doing right now.

```
 OmO Agents  GLOBAL   Agents  DAG   filter:today                 ⠋1 ✔238 ✖1
──────────────────────────────────────────────────────────────────────────────
▍w18:p1 · Update uas-normalize to 7.5.0  ● idle   1 running · 3 done
  ⠙ plan-reviewer    High-accuracy review of tas-github-ci-parity…    9m04s
     └ [grep …/workflows/build-and-publish.yml] I'm confirming the nexus-ur…
  ✔ plan-reviewer    High-accuracy review of tas-github-ci-parity…   10m58s
  ✔ plan-consultant  Gap-analyze TAS GitHub CI parity plan            7m55s
```

## Install

```sh
herdr plugin install rob-64/herdr-omo-agents
```

It needs `bun` or `node` 18+ on `PATH`. Nothing is built or downloaded.

## Open it

| Action | What it does |
| --- | --- |
| `herdr-omo-agents.open` | Popup over the current pane |
| `herdr-omo-agents.open-split` | Split to the right of the current pane |
| `herdr-omo-agents.open-tab` | Its own tab |

Bind one to a key in `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+o"
type = "plugin_action"
command = "herdr-omo-agents.open"
description = "OmO agents board"
```

Or run it from a shell: `herdr plugin action invoke herdr-omo-agents.open`.

### `/agents-pane` in OmO

`omo/agents-command.js` is an OmO extension that adds `/agents-pane [mode]` with tab completion for the mode:

| Mode | Opens |
| --- | --- |
| `split` (default) | Split to the right, focus stays in OmO |
| `split-down` | Split below, focus stays in OmO |
| `overlay` | Zoomed over the current pane until you press `q` |
| `popup` | Floating window over everything |
| `zoomed` | New pane, zoomed to fill the tab |
| `tab` | Its own tab |
| `help` | Lists the modes |

Install it, then start a new OmO session or run `/reload`:

```sh
cp omo/agents-command.js ~/.omo/agent/extensions/herdr-omo-agents.js
```

## Keys

| Key | Action |
| --- | --- |
| `g` | Toggle **global** (every OmO session) / **session** (the OmO session in the pane you opened the board from) |
| `s` | Show the selected row's session |
| `[` `]` | Previous / next session |
| `v` or `Tab` | Toggle **Agents** / **DAG** view |
| `a` | Cycle filter: `active` → `today` → `all` |
| `j` `k` / arrows / wheel | Move selection |
| `Enter` | Focus the herdr pane that owns the selected session |
| `r` | Refresh now |
| `q` / `Esc` | Close |

It opens in **global** scope, **Agents** view, filter **active**.

**Mouse:** click a row to select it and click it again to jump to its pane. Click a session header to open that session and click it again to go back to global. In the header, click `GLOBAL`/`SESSION`, `Agents`/`DAG`, or `filter:` to switch them.

The session in the herdr pane you last focused is highlighted.

## What it shows

- **Agents view**: one block per OmO session, labelled with its herdr pane and title. Open OmO panes are listed even when they have no subagents, so you can see which ones are working or waiting for input. Each subagent shows its status, agent or category, task summary, model, elapsed time, and turns/tool calls. Running subagents get a live line with the current tool call and the latest thought. In global scope, each session lists at most 5 finished subagents; `s` shows the rest.
- **DAG view**: each `mass ulw` / DAG run with a progress bar, then its nodes by stage with dependencies (`← build`), route, attempt, and elapsed time. Failed nodes show their error.
- **Stale detection**: a subagent still marked running whose host process is gone is flagged `!`.

## How it works

The board only reads files; it never writes to OmO state.

- Subagents: `~/.omo/agent/projects/*/senpi-task/tasks/*.json` (plus stores listed in `~/.omo/agent/rpc/task-stores.json`).
- DAG runs: `<store>/dag/runs/*.json`.
- Live activity: the tail of each running subagent's child session transcript.
- Pane ↔ session: the OmO process in each herdr pane (`HERDR_PANE_ID` in its environment) is matched to the session that owns its RPC shard (`~/.omo/agent/rpc/shards/*.meta.json`).

Set `OMO_AGENTS_DIR` to read a different OmO agent directory.

## CLI

`bin/omo-agents` also runs outside herdr:

```sh
bin/omo-agents --once --scope global --view dag --filter all --width 140
bin/omo-agents --json --scope session --session-pane w11:p1
```

## License

MIT
