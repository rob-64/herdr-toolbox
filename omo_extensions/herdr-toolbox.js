import { execFile } from "node:child_process";

const PLUGIN = "herdr-toolbox";

// herdr entrypoints per board: `popup` floats, `pane` is placed by the mode (split/overlay/zoomed/tab).
const BOARDS = {
	"agents-board": { title: "OmO Agents board", popup: "board", pane: "side", env: ["--env", "OMO_BOARD_VIEW=agents"] },
	"pr-board": { title: "GitHub PR board", popup: "prs", pane: "prs-side", env: [] },
};

const AGENTS = BOARDS["agents-board"];

const MODES = [
	{ name: "split", short: "s", help: "split to the right, keep focus here (default)", args: (pane, board = AGENTS) => ["--entrypoint", board.pane, "--placement", "split", "--direction", "right", "--target-pane", pane, "--no-focus"] },
	{ name: "split-down", short: "sd", help: "split below, keep focus here", args: (pane, board = AGENTS) => ["--entrypoint", board.pane, "--placement", "split", "--direction", "down", "--target-pane", pane, "--no-focus"] },
	{ name: "overlay", short: "o", help: "zoom over this pane until you press q", args: (pane, board = AGENTS) => ["--entrypoint", board.pane, "--placement", "overlay", "--focus"] },
	{ name: "popup", short: "p", help: "floating window over everything", args: (pane, board = AGENTS) => ["--entrypoint", board.popup, "--focus"] },
	{ name: "zoomed", short: "z", help: "new pane, zoomed to fill the tab", args: (pane, board = AGENTS) => ["--entrypoint", board.pane, "--placement", "zoomed", "--target-pane", pane, "--focus"] },
	{ name: "tab", short: "t", help: "its own tab", args: (pane, board = AGENTS) => ["--entrypoint", board.pane, "--placement", "tab", "--focus"] },
];

const MODE_HELP_WIDTH = Math.max(...MODES.map((mode) => `${mode.name} (${mode.short})`.length), "help".length);

function modeLabel(mode) {
	return `${mode.name} (${mode.short})`;
}

// A distinct sentinel: every mode also has a `help` (description) field, so `resolved?.help` is truthy for all of them.
export const HELP = Object.freeze({ help: true });

export function resolveMode(arg) {
	const token = String(arg ?? "").trim();
	const key = (token || "split").toLowerCase();
	if (["help", "-h", "--help", "?", "h"].includes(key)) return HELP;
	return MODES.find((entry) => entry.name.toLowerCase() === key || entry.short.toLowerCase() === key);
}

export function getModeArgumentCompletions(prefix) {
	// No popup until a mode is typed: Enter on an open popup runs the highlighted item, so a bare
	// `/agents-board ` must not offer one (it should open the default split).
	// Same for an exact short or full name, so `/agents-board p` runs on the first Enter.
	const p = prefix.trim().toLowerCase();
	if (!p || MODES.some((mode) => mode.short === p || mode.name === p)) return null;
	const items = MODES
		.filter((mode) => mode.name.toLowerCase().startsWith(p) || mode.short.toLowerCase().startsWith(p))
		.map((mode) => ({ value: mode.name, label: modeLabel(mode), description: mode.help }));
	return items.length ? items : null;
}

export function boardHelp(command = "agents-board") {
	return [
		`/${command} [mode]`,
		...MODES.map((mode) => `  ${modeLabel(mode).padEnd(MODE_HELP_WIDTH)} ${mode.help}`),
		`  ${"help".padEnd(MODE_HELP_WIDTH)} show this help`,
	].join("\n");
}

function herdr(args) {
	return new Promise((resolve) => {
		execFile(process.env.HERDR_BIN_PATH || "herdr", args, { timeout: 10000 }, (error, stdout, stderr) =>
			resolve({ error, output: `${stdout}${stderr}`.trim() }),
		);
	});
}

function registerBoard(pi, command, board) {
	pi.registerCommand(command, {
		description: `Open the ${board.title}: /${command} [${MODES.map((mode) => modeLabel(mode)).join("|")}|help]`,
		getArgumentCompletions: getModeArgumentCompletions,
		handler: async (args, ctx) => {
			const modeName = String(args ?? "").trim() || "split";
			const resolved = resolveMode(args);
			if (resolved === HELP) {
				ctx.ui.notify(boardHelp(command), "info");
				return;
			}
			const mode = resolved;
			if (!mode) {
				ctx.ui.notify(`/${command}: unknown mode "${modeName}"\n${boardHelp(command)}`, "error");
				return;
			}
			const pane = process.env.HERDR_PANE_ID;
			if (!pane) {
				ctx.ui.notify(`/${command} only works inside a herdr pane`, "error");
				return;
			}
			const { error, output } = await herdr(["plugin", "pane", "open", "--plugin", PLUGIN, ...board.env, ...mode.args(pane, board)]);
			if (error) ctx.ui.notify(`/${command}: ${output || error.message}`, "error");
		},
	});
}

export default function (pi) {
	for (const [command, board] of Object.entries(BOARDS)) registerBoard(pi, command, board);

	pi.registerCommand("rename-tab", {
		description: "Rename the herdr tab this OmO session is in: /rename-tab <name>",
		handler: async (args, ctx) => {
			const name = String(args ?? "").trim();
			if (!name || ["help", "-h", "--help", "?"].includes(name)) {
				ctx.ui.notify("/rename-tab <name>  rename the herdr tab this OmO session is in", "info");
				return;
			}
			const pane = process.env.HERDR_PANE_ID;
			if (!pane) {
				ctx.ui.notify("/rename-tab only works inside a herdr pane", "error");
				return;
			}
			let tabId;
			const { error, output } = await herdr(["pane", "get", pane]);
			if (!error) {
				try {
					tabId = JSON.parse(output)?.result?.pane?.tab_id;
				} catch {
					// pane may have moved tabs
				}
			}
			if (!tabId) tabId = process.env.HERDR_TAB_ID;
			if (!tabId) {
				ctx.ui.notify("/rename-tab: could not find this pane's tab", "error");
				return;
			}
			// User-set names are treated as the user's; the tab watcher stops auto-renaming that tab.
			const result = await herdr(["tab", "rename", tabId, name]);
			if (result.error) ctx.ui.notify(`/rename-tab: ${result.output || result.error.message}`, "error");
			else ctx.ui.notify(`Renamed tab to "${name}"`, "info");
		},
	});
}
