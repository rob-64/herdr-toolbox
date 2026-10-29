import { execFile } from "node:child_process";

const PLUGIN = "herdr-omo-agents";

const PLACEMENTS = {
	split: (pane) => ["--entrypoint", "side", "--placement", "split", "--direction", "right", "--target-pane", pane, "--no-focus"],
	overlay: () => ["--entrypoint", "side", "--placement", "overlay", "--focus"],
	popup: () => ["--entrypoint", "board", "--focus"],
	tab: () => ["--entrypoint", "side", "--placement", "tab", "--focus"],
};

function herdr(args) {
	return new Promise((resolve) => {
		execFile(process.env.HERDR_BIN_PATH || "herdr", args, { timeout: 10000 }, (error, stdout, stderr) =>
			resolve({ error, output: `${stdout}${stderr}`.trim() }),
		);
	});
}

export default function (pi) {
	pi.registerCommand("agents-pane", {
		description: "Open the OmO Agents board (herdr-omo-agents): /agents-pane [split|overlay|popup|tab]",
		handler: async (args, ctx) => {
			const placement = String(args ?? "").trim() || "split";
			const build = PLACEMENTS[placement];
			if (!build) {
				ctx.ui.notify(`/agents-pane: unknown placement "${placement}" (use split, overlay, popup, or tab)`, "error");
				return;
			}
			const pane = process.env.HERDR_PANE_ID;
			if (!pane) {
				ctx.ui.notify("/agents-pane only works inside a herdr pane", "error");
				return;
			}
			const { error, output } = await herdr(["plugin", "pane", "open", "--plugin", PLUGIN, ...build(pane)]);
			if (error) ctx.ui.notify(`/agents-pane: ${output || error.message}`, "error");
		},
	});
}
