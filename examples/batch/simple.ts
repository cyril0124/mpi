/// <reference path="../../mixcode-batch.d.ts" />

export default (mixcode: MixCodeBatchApi) => {
  for (const target of mixcode.args()) {
    mixcode.openTab({
      name: `review-${target}`,
      prompts: [`Inspect ${target}`, "/color cyan", `Summarize ${target}`],
    });
  }
};
