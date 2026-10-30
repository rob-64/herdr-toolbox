import { execFile } from "node:child_process";

const PLUGIN = "herdr-omo-toolbox";

const MODES = [
	{ name: "split", help: "split to the right, keep focus here (default)", args: (pane) => ["--entrypoint", "side", "--placement", "split", "--direction", "right", "--target-pane", pane, "--no-focus"] },
	{ name: "split-down", help: "split below, keep focus here", args: (pane) => ["--entrypoint", "side", "--placement", "split", "--direction", "down", "--target-pane", pane, "--no-focus"] },
	{ name: "overlay", help: "zoom over this pane until you press q", args: () => ["--entrypoint", "side", "--placement", "overlay", "--focus"] },
	{ name: "popup", help: "floating window over everything", args: () => ["--entrypoint", "board", "--focus"] },
	{ name: "zoomed", help: "new pane, zoomed to fill the tab", args: (pane) => ["--entrypoint", "side", "--placement", "zoomed", "--target-pane", pane, "--focus"] },
	{ name: "tab", help: "its own tab", args: () => ["--entrypoint", "side", "--placement", "tab", "--focus"] },
];

function boardHelp(title) {
	return [
		`${title} [mode]`,
		...MODES.map((mode) => `  ${mode.name.padEnd(10)} ${mode.help}`),
		"  help       show this help",
	].join("\n");
}

function herdr(args) {
	return new Promise((resolve) => {
		execFile(process.env.HERDR_BIN_PATH || "herdr", args, { timeout: 10000 }, (error, stdout, stderr) =>
			resolve({ error, output: `${stdout}${stderr}`.trim() }),
		);
	});
}

function registerBoard(pi, name, title, envView) {
	pi.registerCommand(name, {
		description: `${title}: /${name} [${MODES.map((mode) => mode.name).join("|")}|help]`,
		getArgumentCompletions: (prefix) => {
			const items = [...MODES, { name: "help", help: "show modes" }]
				.filter((mode) => mode.name.startsWith(prefix.trim()))
				.map((mode) => ({ value: mode.name, label: mode.name, description: mode.help }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const modeName = String(args ?? "").trim() || "split";
			if (["help", "-h", "--help", "?"].includes(modeName)) {
				ctx.ui.notify(boardHelp(`/${name}`), "info");
				return;
			}
			const mode = MODES.find((entry) => entry.name === modeName);
			if (!mode) {
				ctx.ui.notify(`/${name}: unknown mode "${modeName}"\n${boardHelp(`/${name}`)}`, "error");
				return;
			}
			const pane = process.env.HERDR_PANE_ID;
			if (!pane) {
				ctx.ui.notify(`/${name} only works inside a herdr pane`, "error");
				return;
			}
			const { error, output } = await herdr([
				"plugin",
				"pane",
				"open",
				"--plugin",
				PLUGIN,
				"--env",
				`OMO_BOARD_VIEW=${envView}`,
				...mode.args(pane),
			]);
			if (error) ctx.ui.notify(`/${name}: ${output || error.message}`, "error");
		},
	});
}

export default function (pi) {
	registerBoard(pi, "agents-board", "Open the OmO Agents board", "agents");
	registerBoard(pi, "tasks-board", "Open the OmO Tasks board", "tasks");

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
