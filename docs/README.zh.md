# Mixcode Fork 文档

[English Documentation](README.md)

本目录是本 fork 自己的文档。上游页面 —— `packages/*/docs/`、各包的 `README.md` 与 `CHANGELOG.md`、以及 `src/**/*.md` —— **都不做修改**：改上游页面会在每次合并上游时产生冲突，所以 fork 的功能写在这里。凡是本 fork 的行为与上游文档不一致的地方，都记录在 [上游漂移](upstream-drift.zh.md)。

## 功能

- **[Agent 标签页](tabs.zh.md)**：一个终端里并行运行多个 agent —— 键位、命令、标签栏状态、颜色、持久化、启动恢复。
- **[命令面板与退出确认](command-palette.zh.md)**：`ctrl+p` 模糊搜索并列出所有可执行命令，`ctrl+q` 在结束会话前先询问。

## Fork 机制

- **[上游漂移](upstream-drift.zh.md)**：本 fork 相对上游改了什么、哪些上游页面因此过期、哪些路径只存在于本 fork。
