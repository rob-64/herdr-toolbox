# Installing herdr-omo-toolbox (for agents)

Instructions for a coding agent installing this plugin for a user. Run the
steps in order, check each result, and stop and report if a check fails.
Commands are for a POSIX shell (zsh/bash) on macOS or Linux.

## 1. Check prerequisites

```sh
herdr --version            # needs 0.9.0 or newer
command -v bun || node --version   # needs bun, or node 18+
```

If `herdr` is missing or older than 0.9.0, stop and tell the user. If neither
`bun` nor node 18+ is on `PATH`, stop and tell the user to install one
(the plugin's build step fails without it).

The tab icons need a Nerd Font in the user's terminal (for example Hack Nerd
Font Mono). If you can't tell which font they use, mention it in your final
report instead of guessing. Without one, icons show as boxes; the user can
turn them off (step 5).

## 2. Install

```sh
herdr plugin install rob-64/herdr-omo-toolbox --yes
```

Verify:

```sh
herdr plugin list --json --plugin herdr-omo-toolbox
```

The result must show `"plugin_id": "herdr-omo-toolbox"` and `"enabled": true`.
Note the `plugin_root` value; step 4 uses it.

## 3. Start the tab watcher

The watcher starts by itself on the next herdr server start or when herdr next
detects an agent. To start it now:

```sh
herdr plugin action invoke herdr-omo-toolbox.tabs-start
```

Within a few seconds, tabs running an agent are renamed to
`<icon> <status> <task title>`:

```sh
herdr tab list
```

Tabs the user named themselves are left alone; only unnamed tabs (`1`, `2`,
…) and stale `OmO - …` labels are renamed. If nothing changes, read the log in
`<state dir>/tabs/watcher.log`, where `<state dir>` is the plugin's
`HERDR_PLUGIN_STATE_DIR` (usually
`~/.local/state/herdr/plugins/herdr-omo-toolbox`).

## 4. Install the OmO extensions (board + status)

The board extension adds `/agents-board [mode]` (each mode has a short alias, e.g. `split`/`s`, `popup`/`p`) and `/rename-tab <name>` (renames the current tab).
Open the tasks board from `/agents-board` with `v` or `Tab`, or via the herdr `open-tasks*` actions.
The status extension reports OmO
idle/working/blocked state (including background tasks) to herdr. OmO loads
extensions from `~/.omo/agent/extensions/`.

If `omo list` shows `npm:omo-herdr`, tell the user it conflicts with the status
extension and ask before removing it with `omo remove npm:omo-herdr`.

```sh
root=$(herdr plugin list --json --plugin herdr-omo-toolbox | jq -r '.result.plugins[0].plugin_root')
mkdir -p ~/.omo/agent/extensions
cp "$root"/omo_extensions/*.js ~/.omo/agent/extensions/
rm -f ~/.omo/agent/extensions/herdr-omo-agents.js   # old extension; opens a plugin that no longer exists
```

If `jq` is not installed, copy the `plugin_root` path from step 2 by hand, or
download the files instead:

```sh
curl -fsSL https://raw.githubusercontent.com/rob-64/herdr-omo-toolbox/main/omo_extensions/herdr-omo-toolbox.js \
  -o ~/.omo/agent/extensions/herdr-omo-toolbox.js
curl -fsSL https://raw.githubusercontent.com/rob-64/herdr-omo-toolbox/main/omo_extensions/herdr-omo-toolbox-status.js \
  -o ~/.omo/agent/extensions/herdr-omo-toolbox-status.js
```

Verify the copies: `grep -q 'herdr-omo-toolbox' ~/.omo/agent/extensions/herdr-omo-toolbox.js` and
`grep -q 'herdr-omo-toolbox.status' ~/.omo/agent/extensions/herdr-omo-toolbox-status.js`.

The extension is picked up by new OmO sessions. Tell the user to run `/reload`
in OmO sessions that are already open. The extension is a copy, so after a
plugin update, repeat this step to refresh it.

## 5. Keybindings and config (ask the user first)

Do not edit the user's herdr config without asking. Offer these bindings for
`~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+tab"
type = "plugin_action"
command = "herdr-omo-toolbox.last-tab"
description = "last tab"

[[keys.command]]
key = "prefix+o"
type = "plugin_action"
command = "herdr-omo-toolbox.open"
description = "OmO agents board"

[[keys.command]]
key = "prefix+t"
type = "plugin_action"
command = "herdr-omo-toolbox.open-tasks"
description = "OmO tasks board"
```

If the user agrees, append them, check for conflicts, and reload:

```sh
herdr config check
herdr server reload-config
```

If `herdr config check` reports a key conflict, ask the user which key to use.

Optional tab-title settings go in `config.json` in the plugin config dir
(`herdr plugin config-dir herdr-omo-toolbox`):

```json
{ "icons": false, "status": true, "max_title": 32 }
```

`"icons": false` turns icons off (use this when there's no Nerd Font). Changes
apply within a few seconds.

## 6. Report

Tell the user:

- that it's installed, and which tabs were renamed;
- that `herdr-bar`, if installed, stops renaming tabs automatically while this
  plugin is enabled (its Cmd+K switcher keeps working);
- whether the extension is installed and that open OmO sessions need `/reload`;
- which keybindings were added, if any.

## Uninstall

```sh
herdr plugin action invoke herdr-omo-toolbox.tabs-stop   # strips icons/status from renamed tabs
herdr plugin uninstall herdr-omo-toolbox
rm -f ~/.omo/agent/extensions/herdr-omo-toolbox.js
rm -f ~/.omo/agent/extensions/herdr-omo-toolbox-status.js
```

Remove any `herdr-omo-toolbox.*` keybindings from `~/.config/herdr/config.toml`,
then run `herdr server reload-config`.
