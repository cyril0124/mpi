# Skill 隔离

[English Documentation](skill-isolation.md)

`MPI_PROJECT_SKILLS_ONLY` 让会话只看到 workdir 自带的 skill。默认关闭；设为 `1`（或 `true`、`on`、`yes`，不区分大小写，忽略首尾空白）后，以下两类 skill 会被丢弃：

- 过滤器接收时作用域为 `user` 的 skill，实际上就是 `<agent dir>/skills` 下的全部；
- 文件位于 workdir 之外的 skill。

作用域在加载器为每个存活的 skill 标注所属根之前读取，因此存活的 skill 之后显示的仍是所属根的标记：`~/.agents/skills` 显示 `[u]`，项目内的显示 `[p]`。

`0`、`false`、`off`、`no`、空值与未设置都保持原有发现行为不变。其余任何非空值都算开启，`MPI_PROJECT_SKILLS_ONLY=disabled` 也是。

该变量适合共享机器：基准测试、评测，或每个仓库一份检出时，不希望个人的 `~/.agents/skills` 进入项目提示词。

## 保留范围

| 根目录 | 默认 | 开启 `MPI_PROJECT_SKILLS_ONLY` |
| --- | --- | --- |
| `<workdir>/.pi/skills` | 加载 | 加载 |
| `<workdir>/.agents/skills` | 加载 | 加载 |
| workdir 之上、直到 git 根的 `.agents/skills` | 加载 | 丢弃 |
| `<agent dir>/skills`（`~/.pi/agent/skills`） | 加载 | 由作用域规则丢弃 |
| `~/.agents/skills` | 加载 | 由路径规则丢弃 |

`~/.agents/skills` 一行假定 workdir 不包含该目录。只要它落在 workdir 内，不论层级多深，路径规则都会保留。`<agent dir>/skills` 没有这种情况：无论它在哪，包括在 workdir 内，作用域规则都会丢弃它。

通过 `--skill` 或设置文件显式加入的路径同样经过该过滤：位于 workdir 之外的 skill 也会被丢弃。

## 生效范围

过滤发生在资源加载器的 `skillsOverride` 钩子里，因此一次判断覆盖所有读取已加载 skill 的界面：

- 系统提示词中的 `<available_skills>` 块，
- 输入框里的 `/skill:<name>` 调用，
- 所有基于已加载 skill 构建的列表（交互模式启动面板、`/skill:` 补全、SDK 会话与 `--rpc`）。

被丢弃的 skill 在上面列出的每个界面都不可见，不只是从提示词里消失。调用一个已不再加载的名字并不会报错：`/skill:<name>` 原样透传，作为普通文本发给模型。

该开关在 CLI 构建会话资源时生效（`packages/coding-agent/src/main.ts` 把 override 传给 `createAgentSessionServices`）。自己构造 `DefaultResourceLoader` 且不传 override 的嵌入方看到全部根，与上游一致。

## 与上游的差异

上游 pi 没有这个变量，总是合并用户与项目两个根。本 fork 只增加开关，不改变未设置时加载的内容，因此不设置它的会话发现行为与上游一致。
