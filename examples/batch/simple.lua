local args = mixcode.args()
for _, target in ipairs(args) do
  mixcode.open_tab({
    name = "review-" .. target,
    prompts = {"Inspect " .. target, "/color cyan", "Summarize " .. target},
  })
end
