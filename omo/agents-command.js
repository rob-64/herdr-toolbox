import { execFile } from "node:child_process";

const PLUGIN = "herdr-omo-agents";

const MODES = [
	{ name: "split", help: "split to the right, keep focus here (default)", args: (pane) => ["--entrypoint", "side", "--placement", "split", "--direction", "right", "--target-pane", pane, "--no-focus"] },
	{ name: "split-down", help: "split below, keep focus here", args: (pane) => ["--entrypoint", "side", "--placement", "split", "--direction", "down", "--target-pane", pane, "--no-focus"] },
	{ name: "overlay", help: "zoom over this pane until you press q", args: () => ["--entrypoint", "side", "--placement", "overlay", "--focus"] },
	{ name: "popup", help: "floating window over everything", args: () => ["--entrypoint", "board", "--focus"] },
	{ name: "zoomed", help: "new pane, zoomed to fill the tab", args: (pane) => ["--entrypoint", "side", "--placement", "zoomed", "--target-pane", pane, "--focus"] },
	{ name: "tab", help: "its own tab", args: () => ["--entrypoint", "side", "--placement", "tab", "--focus"] },
];

const HELP = [
	"/agents-pane [mode]  open the OmO Agents board",
	...MODES.map((mode) => `  ${mode.name.padEnd(10)} ${mode.help}`),
	"  help       show this help",
].join("\n");

function herdr(args) {
	return new Promise((resolve) => {
		execFile(process.env.HERDR_BIN_PATH || "herdr", args, { timeout: 10000 }, (error, stdout, stderr) =>
			resolve({ error, output: `${stdout}${stderr}`.trim() }),
		);
	});
}

export default function (pi) {
	pi.registerCommand("agents-pane", {
		description: `Open the OmO Agents board: /agents-pane [${MODES.map((mode) => mode.name).join("|")}|help]`,
		getArgumentCompletions: (prefix) => {
			const items = [...MODES, { name: "help", help: "show modes" }]
				.filter((mode) => mode.name.startsWith(prefix.trim()))
				.map((mode) => ({ value: mode.name, label: mode.name, description: mode.help }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const name = String(args ?? "").trim() || "split";
			if (["help", "-h", "--help", "?"].includes(name)) {
				ctx.ui.notify(HELP, "info");
				return;
			}
			const mode = MODES.find((entry) => entry.name === name);
			if (!mode) {
				ctx.ui.notify(`/agents-pane: unknown mode "${name}"\n${HELP}`, "error");
				return;
			}
			const pane = process.env.HERDR_PANE_ID;
			if (!pane) {
				ctx.ui.notify("/agents-pane only works inside a herdr pane", "error");
				return;
			}
			const { error, output } = await herdr(["plugin", "pane", "open", "--plugin", PLUGIN, ...mode.args(pane)]);
			if (error) ctx.ui.notify(`/agents-pane: ${output || error.message}`, "error");
		},
	});
}
