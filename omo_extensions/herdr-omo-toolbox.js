import { execFile } from "node:child_process";

const PLUGIN = "herdr-omo-toolbox";

const MODES = [
	{ name: "split", short: "s", help: "split to the right, keep focus here (default)", args: (pane) => ["--entrypoint", "side", "--placement", "split", "--direction", "right", "--target-pane", pane, "--no-focus"] },
	{ name: "split-down", short: "sd", help: "split below, keep focus here", args: (pane) => ["--entrypoint", "side", "--placement", "split", "--direction", "down", "--target-pane", pane, "--no-focus"] },
	{ name: "overlay", short: "o", help: "zoom over this pane until you press q", args: () => ["--entrypoint", "side", "--placement", "overlay", "--focus"] },
	{ name: "popup", short: "p", help: "floating window over everything", args: () => ["--entrypoint", "board", "--focus"] },
	{ name: "zoomed", short: "z", help: "new pane, zoomed to fill the tab", args: (pane) => ["--entrypoint", "side", "--placement", "zoomed", "--target-pane", pane, "--focus"] },
	{ name: "tab", short: "t", help: "its own tab", args: () => ["--entrypoint", "side", "--placement", "tab", "--focus"] },
];

const MODE_HELP_WIDTH = Math.max(...MODES.map((mode) => `${mode.name} (${mode.short})`.length), "help".length);

function modeLabel(mode) {
	return `${mode.name} (${mode.short})`;
}

export function resolveMode(arg) {
	const token = String(arg ?? "").trim();
	const key = (token || "split").toLowerCase();
	if (["help", "-h", "--help", "?", "h"].includes(key)) return { help: true };
	return MODES.find((entry) => entry.name.toLowerCase() === key || entry.short.toLowerCase() === key);
}

export function getModeArgumentCompletions(prefix) {
	const p = prefix.trim().toLowerCase();
	const items = [
		...MODES,
		{ name: "help", short: "h", help: "show modes" },
	]
		.filter((mode) => mode.name.toLowerCase().startsWith(p) || mode.short.toLowerCase().startsWith(p))
		.map((mode) => ({
			value: mode.name,
			label: mode.short ? modeLabel(mode) : mode.name,
			description: mode.help,
		}));
	return items.length ? items : null;
}

export function boardHelp() {
	return [
		"/agents-board [mode]",
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

export default function (pi) {
	pi.registerCommand("agents-board", {
		description: `Open the OmO Agents board: /agents-board [${MODES.map((mode) => modeLabel(mode)).join("|")}|help]`,
		getArgumentCompletions: getModeArgumentCompletions,
		handler: async (args, ctx) => {
			const modeName = String(args ?? "").trim() || "split";
			const resolved = resolveMode(args);
			if (resolved?.help) {
				ctx.ui.notify(boardHelp(), "info");
				return;
			}
			const mode = resolved;
			if (!mode) {
				ctx.ui.notify(`/agents-board: unknown mode "${modeName}"\n${boardHelp()}`, "error");
				return;
			}
			const pane = process.env.HERDR_PANE_ID;
			if (!pane) {
				ctx.ui.notify("/agents-board only works inside a herdr pane", "error");
				return;
			}
			const { error, output } = await herdr([
				"plugin",
				"pane",
				"open",
				"--plugin",
				PLUGIN,
				"--env",
				"OMO_BOARD_VIEW=agents",
				...mode.args(pane),
			]);
			if (error) ctx.ui.notify(`/agents-board: ${output || error.message}`, "error");
		},
	});

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
