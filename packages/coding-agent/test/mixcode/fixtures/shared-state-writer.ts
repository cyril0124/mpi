import { mutateOpenTabs, saveTabMeta } from "../../../src/core/mixcode/multi-tab/mixcode-state.ts";

const [workdir, instance] = process.argv.slice(2);
if (!workdir || !instance) throw new Error("Expected workdir and instance arguments");

process.once("message", () => {
	try {
		for (let index = 0; index < 25; index++) {
			const sessionId = `${instance}-${index}`;
			mutateOpenTabs(workdir, (ids) => {
				ids.add(sessionId);
			});
			saveTabMeta(workdir, [{ sessionId, title: sessionId, workdir, unread: index % 2 === 0 }]);
		}
		process.disconnect();
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
		process.disconnect();
	}
});
process.send?.("ready");
