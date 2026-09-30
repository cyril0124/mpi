/**
 * The `/system-tools` report: every active tool's name, description, owner and
 * parameter schema, followed by each tool's share of the definition tokens.
 */
import { renderTokenBreakdown } from "./token-breakdown.ts";

const REPORT_TITLE = "System Tools";

/**
 * Tool fields the report renders.
 *
 * Loosely typed on purpose: a tool record reaches this renderer from the
 * extension and SDK boundary, where a definition can arrive without a
 * description, a parameter schema or a name, and the report has to render what
 * is there instead of failing.
 */
export interface InspectedTool {
	name?: unknown;
	description?: unknown;
	parameters?: unknown;
	sourceInfo?: { path?: unknown; source?: unknown; scope?: unknown; origin?: unknown };
}

/** Render the `/system-tools` report. Contract: pure formatting. */
export function renderSystemToolsText(tools: readonly InspectedTool[]): string {
	if (tools.length === 0) return `${REPORT_TITLE}\n\nNo tools available.`;
	return `${REPORT_TITLE}\n\n${tools.map(formatSystemTool).join("\n\n")}${renderSystemToolsStats(tools)}`;
}

/**
 * The bytes a tool definition actually sends to the model: name, description and
 * parameter schema. Display-only decoration (source, headings) is excluded.
 */
function toolPayload(tool: InspectedTool): string {
	const parts = [String(tool.name ?? ""), typeof tool.description === "string" ? tool.description : ""];
	if (tool.parameters !== undefined) parts.push(JSON.stringify(tool.parameters));
	return parts.join("\n");
}

function renderSystemToolsStats(tools: readonly InspectedTool[]): string {
	const rows = tools.map((tool) => ({ name: String(tool.name ?? "(unnamed)"), text: toolPayload(tool) }));
	return renderTokenBreakdown(
		"Tool definition breakdown (name + description + parameter schema; token estimates are heuristic: ~4 chars/token, ~1/CJK char):",
		rows,
		rows.map((row) => row.text).join("\n"),
	);
}

function formatSystemTool(tool: InspectedTool): string {
	const lines = [`## == ${String(tool.name ?? "(unnamed)")} ==`];
	if (typeof tool.description === "string" && tool.description.trim()) {
		lines.push("~~~", tool.description.trim(), "~~~");
	}
	const source = formatToolSource(tool.sourceInfo);
	if (source) lines.push(`source: ${source}`);
	if (tool.parameters !== undefined) lines.push("parameters:", JSON.stringify(tool.parameters, null, 2));
	return lines.join("\n");
}

function formatToolSource(sourceInfo: InspectedTool["sourceInfo"]): string {
	if (!sourceInfo) return "";
	return [
		displayToolSource(asString(sourceInfo.source)),
		asString(sourceInfo.scope),
		asString(sourceInfo.origin),
		displayToolSourcePath(asString(sourceInfo.path)),
	]
		.filter(Boolean)
		.join(" | ");
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** Display names for the registry's two tool sources: pi's own set and host-registered tools. */
function displayToolSource(source: string): string {
	if (source === "builtin") return "pi-builtin";
	if (source === "sdk") return "mixcode-custom";
	return source;
}

function displayToolSourcePath(path: string): string {
	return path.replace(/^<builtin:/, "<pi-builtin:").replace(/^<sdk:/, "<mixcode-custom:");
}
