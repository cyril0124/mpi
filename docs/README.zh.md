# Mixcode Fork 文档

[English Documentation](README.md)

本目录是本 fork 自己的文档。上游页面 —— `packages/*/docs/`、各包的 `README.md` 与 `CHANGELOG.md`、以及 `src/**/*.md` —— **都不做修改**：改上游页面会在每次合并上游时产生冲突，所以 fork 的功能写在这里。凡是本 fork 的行为与上游文档不一致的地方，都记录在 [上游漂移](upstream-drift.zh.md)。

## 功能

- **[Agent 标签页](tabs.zh.md)**：一个终端里并行运行多个 agent —— 键位、命令、标签栏状态、颜色、持久化、启动恢复。
- **[命令面板与退出确认](command-palette.zh.md)**：`ctrl+p` 模糊搜索并列出所有可执行命令，`ctrl+q` 在结束会话前先询问。
- **[Vim 模式](vim-mode.zh.md)**：全屏对话区的模态导航（进入方式、按键、按标签页的行为、全屏前提）。
- **[窗口化对话渲染](windowed-transcript.zh.md)**：全屏对话区如何只渲染可见块、保持滚动范围正确，以及鼠标交互行为。
- **[MixCode Home](home.zh.md)**：列出所有已打开 agent 的起始页面，展示所选 agent 的对话预览，并可新建或恢复会话。

## Fork 机制

- **[上游漂移](upstream-drift.zh.md)**：本 fork 相对上游改了什么、哪些上游页面因此过期、哪些路径只存在于本 fork。
