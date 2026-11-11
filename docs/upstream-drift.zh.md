# 上游漂移

[English Documentation](upstream-drift.md)

本 fork 与上游 pi 存在分歧的地方。上游页面**不做修改** —— 那会在每次合并上游时产生冲突 —— 所以分歧记录在这里，并与造成分歧的改动放在同一个 commit。

## 行为差异

| 方面 | 上游 | 本 fork | 原因 |
| --- | --- | --- | --- |
| 单文件图片与剪贴板资源 | Photon 在可执行文件旁找 WASM；TUI 在模块、安装包或可执行文件旁找原生模块 | 两者也会检查解压后的包根目录 `PI_PACKAGE_DIR` | `mpi` 单文件安装在只读目录中也无需并排资源文件 |
| `install.sh` | 通过 `scripts/build-binaries.sh` 构建发布归档 | 在 `<prefix>/lib/<name>/` 安装 standalone 运行时，并在 `<prefix>/bin/<name>` 安装包装脚本；`<name>` 默认为 `mpi`，也可通过 `--name` 或 `INSTALL_NAME` 设置 | 单机安装可以使用自定义命令名，同时保持运行时目录与包装脚本名称一致 |
| 发行名称 | 应用是 `pi`；`ENV_AGENT_DIR` / `ENV_SESSION_DIR` 由 `APP_NAME` 推导，调试日志为 `pi-debug.log` | `piConfig.name` 设为 `mpi`，因此 `--help`、包管理子命令帮助、终端标题与运行时报错都显示 `mpi`；`PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR` 在 `config.ts` 里固定为上游名字，不支持的 `update` 命令也不再列在 `--help` | 本 fork 以 `mpi` 安装与分发（见 `install.sh`），同时不移动用户的 agent 目录环境变量与共用的 `.pi` 目录 |
| 内置主题发现 | `getBuiltinThemes()` 按名字读取 `dark.json` 与 `light.json`，丢进主题目录的 JSON 不会被发现；主题选择器只列出它们与用户主题 | 主题目录下每个 `*.json` 都会被加载，并以文件内的 `name` 作为键（跳过 `theme-schema.json`）；某个文件解析或校验失败时只是被丢弃，不会带掉其余内置主题。`aurora` 即由此提供 | 一个主题一个文件，新增主题就是新增文件，无需改动加载器 |
| `app.thinking.cycle` 默认键 | `shift+tab` | `alt+t` | `shift+tab` 改作 `app.tab.previous` |
| Agent 标签页 | 一个终端一个会话 | 多个并发标签页，各自持有 `AgentSessionRuntime`；回复生成期间切回时，用已保存历史与当前流式消息重建对话区 | 切换标签后，正在生成的回答必须继续显示与更新；见 [Agent 标签页](tabs.zh.md) |
| 仓库检查范围 | Biome 和依赖、导入扫描可能遍历嵌套的临时 checkout | 这些扫描排除 `tmp/`、`.worktrees/` 和 `.sync-feature/` | 本地复现目录和 worktree 各自包含源码与配置 |
| 历史压缩次数提示 | 加载会话历史时显示 `Session compacted N times` | 每个会话在进程内显示一次：启动、首次进入该标签页、切换分支时显示；不参与状态行的复用，后续状态不会覆盖它；离开过的标签页再次返回时不再显示 | 切换标签页不会压缩会话 |
| 标签页标题同步 | 无 agent 标签页 | 普通标签页跟随之后的会话改名，包括扩展发起的改名；batch 锁定的标题保留指定名字 | 已有名字的标签页也必须反映成功的会话改名；见[标题](tabs.zh.md#标题) |
| 启动时恢复标签页 | 不适用（一个终端一个会话） | 停在扩展 `session_start` 对话框的标签页会把队列让给下一个标签页，在 Home 卡片上显示 `[input]`，答复后自行收尾 | 串行恢复不能等待人工输入；见 [Agent 标签页](tabs.zh.md#启动恢复) |
| 输入框提交 | 输入文本走输入主循环，由该循环把队列投给当前会话 | 等待扩展之前锁定输入框所属的标签页和会话；提示与压缩队列保留该归属，本地命令执行前挂载原标签页，失败只恢复原标签页的空草稿；只有没有标签管理器时才用共享队列 | 等待期间切页不能把输入送到另一段对话，也不能覆盖另一页草稿；见 [Agent 标签页](tabs.zh.md#并发访问) |
| `/fork` 消息选择 | 替换当前会话 | 在原标签页后创建独立标签页，标题追加 `-fork` 并自动去重，输入框填入所选消息 | 原对话与新分支可以并排保留 |
| `/resume` | 用选中的会话替换当前会话 | 选中的会话在自己的标签页里打开；已在某标签页打开的会话则聚焦那个标签页 | 焦点标签页的对话与恢复出来的会话并存，且两个 runtime 不能同时往一个会话文件追加 |
| `/resume` 的扩展否决 | `session_before_switch` 以 `resume` 原因触发，扩展可以取消这次替换 | 选中的会话挂载成新标签页，没有 runtime 替换自己的会话，因此该否决不会触发；新标签页的 `session_start` 原因为 `resume` | `/clone` 与为对端打开的标签页出于同样原因不触发该否决 |
| `/new` | 用新文件替换当前会话，正在进行的回合会被中断 | 回合或 bash 运行中拒绝执行，新会话沿用旧 header 的 parent，标签页底色随会话一起丢掉 | 替换会话不该打断正在跑的回合；新旧两个会话互为兄弟；底色按 session id 存，新会话本就没有 |
| `/reset` | 无此命令；回到一段对话的根节点只能在 `/tree` 里手动导航 | `/reset` 在同一文件里把叶子退回会话根，保留标签页、标题与全部条目，旧分支仍在 `/tree` 可达 | 回到根节点不该先打开树选择器，而被放弃的分支值得留下 |
| `/editor` | 无此命令；草稿只能通过 `app.editor.external` 按键交给外部编辑器 | `/editor` 从斜杠输入与命令面板打开同一个编辑器，并保留它写入的内容（清空成空草稿也算） | 编辑器槽位里是面板的命令文本时，草稿也需要能编辑 |
| 会话删除 | 直接删除所选会话文件 | 所属标签页有对话或 `!` 命令进行中时拒绝 | 可能还有另一个标签页在写该文件 |
| 已删除会话 | 直接 unlink 文件 | 文件移入 `<agent dir>/mixcode-pi/trash/` 并记入 `trash-index.jsonl`（上限 2 GiB，先淘汰最旧），`/resume-trash` 可把选中的一条还原回原路径；移动失败则退回系统 `trash` CLI、再退回 unlink | 误按 `/delete-session` 应当可撤销，不必依赖备份；该 trash 目录与 mixcode-pi 共用 |
| `app.model.cycleForward` 默认键 | `ctrl+p` | 无默认键 | `ctrl+p` 改作打开命令面板 |
| `app.tab.jump` 默认键 | 无此动作；`ctrl+t` 切换 thinking 块显示 | `ctrl+t` 打开 Tab Jump 切换浮层，`app.thinking.toggle` 保留 `ctrl+t` 默认值但在 composer 中按注册顺序把该键让给跳转 | 有多个 agent 时应当直接跳过去，而不是逐个循环；见 [Agent 标签页](tabs.zh.md#标签页跳转) |
| 运行中按 `Escape` | 第一次按下即中断运行 | 第一次按下只武装 1 秒确认窗口并提示 `<中断键> again: stop`，第二次按下才中断；本轮还没有可见输出时改为回撤：分支 leaf 回到本轮自己的用户消息之前，文本回到输入框 | 一次误按不应丢掉还没开始回答的提示，回撤出来的文本可以直接改完再发；见[按键绑定](keybindings.zh.md#escape) |
| 退出 | `ctrl+d` 直接退出，不询问 | `ctrl+q`（Windows 与 WSL 为 `ctrl+shift+q`）先询问；`ctrl+d` 不变 | [命令面板与退出确认](command-palette.zh.md) |
| 对话区 resize 锚点 | 改变宽度时保留数字滚动行，因此消息换行后读者可能跳到另一个对话块 | 全屏窗口化对话区在重新排版后重新锚定第一条可见消息及其块内进度 | 已经向上滚动的读者在调整终端大小时应继续阅读同一段对话 |
| 全屏对话区渲染 | 每帧渲染全部消息组件再裁剪到视口 | 只渲染可见窗口（上下各 20 行余量），未测块按 4 行估算；行号对照首个可见块解析而不是数出来，不是滚动的帧在自己实测之后会把那个块留在原来的行，因此重绘与视口高度变化都不会滑动读者所在的行；`HStack` 不再为已有高度的拉伸子项测量其固有高度，因此侧边面板列不会把对话区整体渲染一遍 | 否则帧开销随整段对话增长，改变终端宽度时还会把每条消息重新排版，而在视口上方实测一个估算块会重排其下方的所有行 |
| 对话区滚动键 | 仅 `tui.altScreen.*` | 全屏模式下另有模态界面（`/vim`、`j`/`k`/`gg`/`G`、提问跳转），其 Vim 模式用 `app.vim.top`/`app.vim.bottom` 跳到对话区两端；平凡的 `home`/`end` 留给输入框，上游的 `ctrl+home`/`ctrl+end` 用于滚动对话区；vim 模式接管输入时，`pageUp`/`pageDown` 走 `app.vim.pageUp`/`pageDown` 的 10 行，而不是视口的整页 | 长对话免鼠标阅读 |
| 提交后是否跟随末尾 | 新输出仅在视口已经在末尾时跟随末尾，滚上去后提交不会移动视口 | 用户消息会把全屏对话区滚到末尾并恢复跟随 | 刚发出的消息与下面的回答必须无需滚动即可看到；提交是用户自己的动作，而流式输出仍不能把视口从正在阅读的人手里抢走 |
| 默认 TUI 模式 | `regular` | `fullscreen`；`settings.json` 里显式写 `tuiMode: "regular"` 仍会回到普通对话区 | 本 fork 的阅读功能（窗口化对话区、Vim、鼠标选中）只存在于备选屏幕；上游 `packages/coding-agent/docs/settings.md` 的默认值仍写作 `"regular"` |
| 模态下的输入框边框 | thinking/bash 边框色 | 强调色边框，不画光标，输入与提交被锁定 | Vim 模式独占输入 |
| Zen 专注模式 | 无此模式；上游没有可隐藏的标签栏 | `/toggle-zen-mode` 去掉标签块，只留分隔线继续显示其他 agent 的状态圆点；agent 标签页处于 zen 时 `tab`/`shift+tab` 不再切换标签页 | 标签块占用的那一行要让给对话区，而标签栏仍需汇报其他 agent 的动向；见 [Zen 专注模式](zen-mode.zh.md) |
| 扩展组件 | 固定在编辑器上/下方的坞区 | 默认放在对话流末尾，带行预算与 `/widgets`，因为 [`ui.inlineWidgets`](inline-widgets.zh.md) 默认开启 | 过高的组件否则会占用整个编辑器坞区的行 |
| 按标签页的设置项 | 无 | `Inline widgets` 读写 `mixcode_settings.json`，在 `/settings` 的 `MixCode` 分组中单独展示 | MixCode 的设置不写进 pi 的 `settings.json`，也不混进它的分组 |
| 设置列表行 | 单一平铺列表 | `SettingItem` 新增可选 `section`，渲染为分组标题行 | 同上 |
| `/settings` 面板 | 上游 `SettingsList` 放在带边框的 selector 里并替换编辑器区域：`→` 光标、搜索输入框、原始的 `true`/`false` 取值、平直的分组标题 | 居中浮层面板，标题为 `Settings`：surface 背景的列表配一条暗色 `filter: type to filter  N/N` 行，每个配置文件上方是 `Pi` / `MixCode` 标题加该文件路径，`›` 行分为标签列与取值列，布尔值显示为 `On`/`Off`，选中项下方显示其说明，底部一行按键提示 | 面板因此像浮在工作内容之上的一层表面，并直接说明某项设置存在哪个文件里；打开面板时输入框保留草稿。选择 `TUI mode` 会先收起面板再切换，因为浮层打开时模式切换会被拒绝 |
| Follow-up 输入（`alt+enter`） | 排入 SDK follow-up 队列，由 agent 在运行结束后投递 | 改为宿主侧的轮次：`/follow-up <message>` 产生独占轮次，`alt+enter` 与 `/follow-up --batch <message>` 产生合并轮次，空闲时每轮投递一次，失败时暂停直到 `/follow-up` 恢复；可排队的本地命令会先挂到它所属的标签页再执行，因为它经过共享输入框执行 | follow-up 轮次需要暂停/恢复、批量合并，以及可排队的本地命令 |
| 跨标签页压缩 | 只有一个会话，状态提示与完成处理始终挂载 | 切换标签页后保留压缩原因与摘要模型标签，压缩期间显示忙碌圆点；持久化摘要显示在保留消息之后、后续轮次之前 | 后台完成的摘要必须在原标签页可见 |
| 手动压缩模型 | `/compact` 只接受自定义指令并使用当前模型 | `/compact [provider/modelId] [instructions]` 仅为摘要请求使用指定模型，会话模型与 thinking 等级保持不变，并在工作状态中显示指定模型；只有模型目录能解析、或其 provider 已知时，首个词才算模型引用，因此 `src/auth.ts` 这类路径仍留在指令里；压缩原因分别使用 accent/warning/error 颜色 | 手动摘要有时需要使用另一个模型，临时状态需要区分手动、阈值和溢出压缩 |
| 排队消息显示 | 对话区下方的平铺 `Steering:`/`Follow-up:` 行 | 带边框的 `Steer (n)`/`Follow-up (n)` 预览，含轮次编号（`Round k · next/command ·`）、`SDK ·` 伴随标记、只显示最近五条、暂停提示，以及 `Esc->send now`/编辑提示 | 队列现在是有序轮次列表，而不是文本堆 |
| Esc 时有排队的 steer 文本 | 把每一条排队消息还原到输入框并中止 | 中止，然后把 steer 队列作为一次立即轮次发送；follow-up 轮次保持排队（暂停） | `Esc->send now` 不应把 follow-up 轮次一并发出 |
| settle 时残留的 steer 文本 | 留在 SDK steering 队列里，直到下一次提交启动一次运行 | 在没有 compaction 或 resume 接管会话时，于 `agent_settled` 把它作为一个轮次发出（`scheduleSteerSettleFlush`）；settle 之后的交接留给接管方 | 上一轮结束时入队的文本此前没有任何东西会把它发出去（`flushCompactionQueue` 的剩余 steer 文本就是这样入队的） |
| `AgentSession`/`Agent` 队列 API | 只有 `clearQueue()`/`clearAllQueues()` | 新增 `removeQueuedMessages(kind, texts)`/`restoreQueuedMessages(kind, removed)`：从镜像与待发队列中按精确文本出队（最后匹配优先），返回按队列顺序排列的条目供还原 | flush 与 pop 需要移除指定文本，而不是整个队列 |
| 出队键（`app.message.dequeue`） | `alt+up`（Windows 与 WSL 为 `alt+q`）；把每一条排队消息还原到输入框；编辑器保留 `ctrl+u` 做删除到行首 | `ctrl+u`，与无排队消息时的 vim 入口共用（排队消息先占用该键；只有 fullscreen 下的 agent 标签页才武装 vim 入口，因为 Home 挡住了该标签页的对话区、自身也没有视口，没有视口时出队动作会提示没有可还原的消息）且在 agent 标签页上无论如何都会被消费，因此不再到达编辑器；两个队列都有内容时 `ctrl+u` 后按 `s`/`f` 选一个，单个队列则把最后一条弹入输入框并重建 `/follow-up`（及 `--batch`）形式，镜像文本也会离开 SDK 队列 | 按队列编辑归为一个快捷键，且 `ctrl+u` 与队列工作流相配 |
| 坞区组件堆叠 | 无上限；空间不够时由布局压缩槽位 | 上方与下方两个槽位共用一个行预算，被裁掉的行用 `… (widgets truncated)` 标出 | 否则很高的组件堆叠会挤掉对话区与坞区其他部分 |
| 跨标签页的 `/settings` | 每个终端一个会话，没有可传递的对象 | 修改会让所有打开的标签页重新读取设置文件，并重新应用会话从各自管理器拷贝的值；获得焦点的标签页也会重新读取 | 一个进程持有多个会话，全局配置行必须让它们全部跟随；见 [Agent Tabs](tabs.zh.md#设置) |
| 鼠标拖拽选中 | 屏幕上任意格子都可选中，原样复制该格子，用反显上色，拖动期间继续跟随新输出 | 只在对话区、输入卡片与 Notice 面板内生效；复制文本会去掉这些区域自身的边框、内缩与按键提示行；高亮使用主题的 `selectedBg`，开启 copy-on-select（默认）时随松手清除，关闭该设置时保留供复制命令取用，并在带指针悬停提示的块内的卡片行上加下划线（悬停提示用的是同一个背景色）；按下会钉住对话区，使流式输出挪不动选中行，松开时若期间有输出或用户滚动过则停在那里 | [鼠标拖拽选中](mouse-selection.zh.md) |
| 隐藏的 thinking | 关闭隐藏时显示完整思考文本；开启时默认显示斜体 `Thinking...`，显式把标签设为空字符串或纯空白时则不显示整块及其间距 | 开启隐藏时，每个块渲染为跟随流式输出的 3 行尾窗：`Thinking` 标题的耗时在流式期间实时走动、思考停止增长后冻结，左侧竖线后是最后三行可见内容，丢弃了更早内容时首行加 `…`。扩展的非空 `setHiddenThinkingLabel` 仍整块替换；空字符串、纯空白或未设置的标签保留尾窗回退（关闭预览或没有可显示文本时回退为 `Thinking...`），不会隐藏整块；`/settings` 的 `Thinking tail preview` 行可关闭，默认开启 | 尾窗让思考在流式期间保持可读，又不让该块占满整个对话区 |
| MixCode Home | 没有此页面；transcript 始终显示当前会话 | `home` 伪标签页列出所有已打开 agent 并给出对话预览 | [MixCode Home](home.zh.md) |
| `left`/`right`/`up`/`down`/`enter`/`ctrl+f` | 编辑器光标、历史、提交 | 在 Home 上用于选择/附着/发送/过滤列表；在 agent 标签页仍归编辑器 | [MixCode Home](home.zh.md) |
| 应用动作键处理器 | 命中的处理器直接消费该按键 | 处理器可返回 `false` 主动放弃该键，并会收到原始按键数据 | Home 的绑定不能抢走输入框的 `up`/`down`/`left`/`right`/`enter`，而 `enter` 同时匹配裸换行（`ctrl+j`） |
| 历史归属 | 一个终端一个会话和编辑器 | 历史属于标签页，在每次挂载默认或扩展编辑器后重建；该标签页的原始提交文本和暂存草稿仍可召回 | 替换编辑器不能保留另一页的条目，也不能丢掉被扩展处理的输入 |
| 历史回溯 | 回溯到的条目，`up` 时光标在其开头、`down` 时在末尾；浏览多行条目时方向键在条目内移动光标 | 回溯到的条目光标一律在末尾；浏览期间方向键继续在条目间步进 | 光标应落在下一次输入的位置，唤回后是追加而不是从头覆盖；浏览也不该被多行条目卡住 |
| 空输入框 | 不显示任何内容 | agent 标签页提示 `Describe your next change...  @ files  / commands  ← Home · → widgets`，Vim 标签页列出导航键位，Home 上写出目标 agent 并用中性的 thinking 边框色 | 名册明确了目标；Home 自身没有 thinking 等级；输入框也说明它能接受什么。两个按键提示取自实际键位绑定，在不会分栏的 TUI 模式下不显示侧栏那一半 |
| 交互模式下的控制台输出 | `console.log` 等方法直接写到终端 | 画进底部居中的 `Notice` 弹窗（不进对话记录）；`/console-history` 把最近 1000 行交给外部编辑器打开，带时间戳与产生它的标签页 | [控制台历史](console-history.zh.md) |
| 输入框边框 | 输入框上下各一条平直的分隔线 | 圆角卡片，上边框承载工作状态、模式徽标、标签页名与精确上下文用量，卡片内文字与左边框之间空出一格 | 输入区无需额外表头即可说明当前 agent 与上下文；见 [输入坞区](input-dock.zh.md) |
| 编辑器被替换后的 chrome | 无标签栏；扩展替换的编辑器自行绘制边框，不显示 agent 标签 | 当 `setEditorComponent` 提供编辑器时，标签栏下方的分隔线承载标签页名、`[VIM]`/`[ZEN]` 徽标与 `/context-limit` 覆写读数 | 原本承载 agent 名与上下文的卡片随编辑器一同消失，而分隔线每帧都会绘制；见 [输入坞区](input-dock.zh.md) |
| 编辑器坞区页脚 | 两行：工作目录与会话名，然后是 token 与费用合计加 `percent (auto)`，同一行右侧是模型名与 thinking 等级；注册了扩展状态时再加一行 | 一行 meta：模型、thinking 与工作目录、八格上下文进度条与 git 分支，再接扩展状态行；模型、thinking 与工作目录都可点击，按下即打开各自的选择器 | 标签页名与精确 token 数已由卡片上边框承载，模型标签带 provider，进度条也比百分比更易读；见 [输入坞区](input-dock.zh.md) |
| meta 行图标 | 页脚以文字写出模型与 thinking 等级，其他内容不带任何字形 | meta 行的两种完整布局给模型与 thinking 各加一个 Nerd Font 图标，上下文进度条与 git 分支同样带图标；`ui.icons.mode`（`nerd`、`ascii`、`auto`）选择字形集，`auto` 会探测终端 | 图标让字段一眼可辨；ASCII 回退保证没有该字体的终端不会画出方框。见 [图标](icons.zh.md) |
| 工作目录 | 启动时确定：`--workdir` 或进程 cwd；会话整个生命周期都用它 | `/workdir [path]` 把活动标签页切到另一个目录，meta 行上的工作目录徽标打开同一个选择器 | 把标签页指向另一个项目不该意味着重启 agent；见 [工作目录](tabs.zh.md#工作目录) |
| Home 上的页脚 | 无此页面 | Home 会收起坞区页脚，因此没有 meta 行 | 名册已经列出每个 agent 及其上下文，而 Home 自身没有会话 |
| 用户消息块 | 带背景的消息文本块 | 同一块内容，但在首行右端显示发送时间（`Sep 29, 9:29 PM`：短月份、日、时、分，取终端自身区域设置），以暗色绘制，正文渲染宽度相应收窄，任何文字都不会压到时间上 | 消息块自身说明了发送时刻，长对话无需打开会话列表就能按时间阅读 |
| 指针 hover 反馈 | 无提示：列表忽略指针移动，消息区域只响应点击，跳到底部标签只有一种样式 | 指针下的单元格获得选中背景与下划线（标签页 chip、命令面板行、坞区 meta 行的模型与 thinking 字段）；响应点击的消息块整块填充为一个矩形；全屏渲染器在指针离开后告知对应组件，捕获型浮层打开时保持其下方界面无高亮，非捕获型浮层区域外仍保持 hover，终端尺寸变化时清除所有 hover | 本 fork 的可点击界面需要一个不改变键盘选择与活动标签页的提示 |
| 扩展模块解析 | bun 跑构建产物时保留 jiti 的 `tryNative`（原生 TS 导入），扩展的 `@earendil-works/*` 裸导入因此从环境 `node_modules` 解析 | bun 跑构建产物时改走 `virtualModules`，清单内的 specifier 一律取运行中宿主自己的那份；bun 跑 TypeScript 源码不受影响 | 第二份 `@earendil-works/pi-tui` 会让 `ToolExecutionComponent.prototype` 的补丁打在宿主从未渲染的类上，渲染扩展于是静默退回内置工具行 |
| 新版本提示 | 启动时请求 `pi.dev/api/latest-version`，打印带 changelog 链接的 `Update Available` 块，由 `PI_SKIP_VERSION_CHECK` 关闭 | 不再提示 pi 自身的新版本：启动检查、`checkForNewPiVersion` 与 `PI_SKIP_VERSION_CHECK` 均已删除 | 本 fork 改为只在 [MixCode Home](home.zh.md) 报告过期的扩展包 |
| 退出恢复提示 | 已持久化的会话在交互式退出时打印 `To resume this session: pi --session <id>` | 不再打印该输出；负责拼装它的 `formatResumeCommand` 辅助函数保留下来，供上游的安装变更提醒使用 | MixCode 在一个进程里保留多个会话并通过自己的标签页进入，pi 的 `--session` 命令不是恢复会话的方式 |
| 设置覆盖 | `applyOverrides` 把值叠加到生效设置上，下一次从各作用域重新组合（`save`、`reload`、信任状态变化）时就会丢失 | 覆盖层会被保留，并在每次重新组合时重新合并；`clearOverrides` 用于释放指定字段 | 标签页的 `/context-limit` 会收窄压缩预算，否则中途一次设置写入就会在无提示的情况下恢复完整预算 |
| Batch 自动化 | 没有 `/batch` 命令，也没有 `--batch` / `--batch-dry-run`；`--` 始终收集消息与 `@file` 参数 | `/batch <script> [-- <args...>]`、`--batch`、`--batch-dry-run` 运行 Lua 或 TypeScript 脚本以打开 agent 标签页；带 `--batch` 时 `--` 传递脚本参数而不是消息，并新增 `fengari` 作为 coding-agent 依赖 | 用脚本铺开一批 agent 标签页需要一个统一入口，且参数必须原样到达脚本；见 [Batch 脚本](batch-scripts.zh.md) |
| 模型失败诊断 | 失败的请求只保留 provider 格式化后的 `errorMessage`，原始异常在进程结束后就没了，类型、错误码与 HTTP 状态都无迹可循 | 每个内置文本适配器接受 `StreamOptions.onProviderError`，在自己的终止 catch 里把原始异常交给它；交互模式再把观察者装到共享 `ModelRuntime` 上，向控制台历史写入一行有界的 `[provider-error]`（`provider`、`model`、`api`，以及最多五个 `{name, code, status}` 节点） | 用户能行动的是 provider 自己的那句话，而真正失败的原因以前只有挂着调试器才看得到；见[模型请求错误诊断](provider-errors.zh.md) |
| Skill 发现 | 每个会话都会把项目根（`<workdir>/.pi/skills` 与从 workdir 到 git 根的 `.agents/skills` 目录）同用户根（`<agent dir>/skills`、`~/.agents/skills`）合并 | `MPI_PROJECT_SKILLS_ONLY` 在加载器的 `skillsOverride` 里丢弃过滤器接收时作用域为 `user` 的 skill（`<agent dir>/skills`），以及文件位于 workdir 之外的 skill，使系统提示词与 `/skill:<name>` 列表保持一致；未设置时不改动发现行为 | 共享机器、评测或每仓库一份检出时，需要能把个人 skill 挡在项目提示词之外；见 [Skill 隔离](skill-isolation.zh.md) |
| Herdr 窗格状态 | 既没有宿主标记，也没有进程级扩展通道：想向终端复用器上报窗格状态的扩展既没东西可把守，也没东西可监听 | `main()` 把进程标记为 MixCode（`MIXCODE ??= "1"`），并把每个标签的 `EventBus` 登记起来，宿主因而能向全部实例广播 `mpi:waiting-for-input` `{count, active}`（所有已打开标签中的扩展对话框）与 `mpi:mark-done` `{reason}`（`/mark-done` 之后 5 秒） | `mpi-herdr-report` 两者都需要：看不见 `mpi` 活动的 Herdr 侧边栏会把每个窗格都显示为 `unknown`。上报器本身不由本 fork 分发；见 [Herdr 窗格上报](herdr.zh.md) |
| 扩展缓存位置 | `jiti` 把转译后的扩展缓存到调用 `createJiti` 的那个模块旁的 `node_modules/.cache/jiti`，没有这样的 `node_modules` 时缓存到 `<os.tmpdir()>/jiti`；tmpdir 兜底目录已属于其他用户时探测失败，于是静默地不使用缓存，每次启动都重新转译全部扩展 | 扩展加载器与 batch 执行器都传 `cache: resolveJitiCacheDir()`，解析为 `<agent dir>/cache/jiti`，agent 目录存不下时返回 `false`（不落盘缓存）；从不使用共享 tmpdir，也不改 `TMPDIR`；超过 30 天未写入的条目最多每 24 小时清理一次 | `/tmp` 不是用户自己的空间，一个用户的缓存会静默地把另一个用户的缓存关掉；agent 目录已是本 fork 其他缓存的家，清理规则则避免持久缓存无限增长 |

扩展对话框复用现有的每标签页交互栈，而不是上游单一的编辑器槽位栈。关闭或中止隐藏的
对话框不会抢走可见对话框的焦点；返回标签页时恢复其待处理对话框和阻塞状态。应用自身的
界面快捷键（标签页切换与跳转、新建/关闭标签页、命令面板、退出）在两种对话框表面之上仍然
生效：持有焦点的捕获型 overlay，以及当前屏上标签页编辑器槽位中的对话框，除非其上还叠有
另一个捕获型 overlay。跨标签页覆盖位于
`packages/coding-agent/test/mixcode/extension-dialog-stack.test.ts`，快捷键路由位于
`packages/coding-agent/test/mixcode/extension-dialog-shortcuts.test.ts`；上游对话框
测试使用接入 fork 控制器的宿主。

## 已过期的上游页面与源码文案

有意不打补丁：

| 页面 | 原文 | 实际 |
| --- | --- | --- |
| `packages/coding-agent/docs/session-format.md:20` | "When available, pi uses the `trash` CLI to avoid permanent deletion" | `/delete-session` 与选择器把文件移入 `<agentDir>/mixcode-pi/trash/`；系统 `trash` CLI 只在移动失败时使用 |
| `packages/coding-agent/docs/usage.md:92` | `/debug` 把输出写入 `pi-debug.log` | 文件名是 `mpi-debug.log`，因为调试日志名跟随 `APP_NAME` |
| `packages/coding-agent/docs/cli-integration.md:95` | `piConfig.name` 会影响 "the CLI banner, configuration paths, and derived environment variable names" | 本 fork 把环境变量名固定为 `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR`，因此 `piConfig.name` 不再改变它们 |
| `packages/coding-agent/docs/usage.md:49` | "Press `Shift+Tab` to cycle through supported levels" | 循环键是 `alt+t` |
| `packages/coding-agent/docs/keybindings.md:155` | `app.thinking.cycle` 默认 `shift+tab` | 默认是 `alt+t` |
| `packages/coding-agent/src/experimental/micro/README.md:30` | "Shift+Tab: cycle the current model's supported thinking levels" | micro 的状态行读的是实时绑定，只有这行硬编码文本是错的 |
| `packages/coding-agent/docs/keybindings.md:152` | `app.model.cycleForward` 默认 `ctrl+p` | 无默认键；`ctrl+p` 是 `app.palette` |
| `packages/coding-agent/docs/models.md:33` | "`Ctrl+P` cycles through available models" | `ctrl+p` 打开命令面板；只有 `shift+ctrl+p` 仍可循环，且只能回到上一个模型 |
| `packages/coding-agent/src/cli/args.ts:303`（源码文案） | `--models` 帮助说是 "patterns for Ctrl+P cycling" | `ctrl+p` 打开命令面板；循环键是 `shift+ctrl+p`（Windows 与 WSL 为 `alt+p`） |
| `packages/coding-agent/docs/custom-provider.md:102-105` | 自定义 provider 的请求仪表清单只列了 `options.onPayload`、`options.onResponse` 与 abort signal | 会捕获请求失败的 provider 还必须调用 `options.onProviderError(error, model)`；见[模型请求错误诊断](provider-errors.zh.md) |
| `packages/coding-agent/docs/slash-commands.md:30` | `/compact [instructions]` | 本 fork 还接受前置的 `provider/modelId`，让摘要只用该模型执行；首个词不是已知 provider 或模型时按指令文本处理 |
| `packages/coding-agent/docs/compaction.md:41` | "trigger manually with `/compact [instructions]`" | 同上：可在指令前指定摘要模型，开头的路径仍属于指令 |
| `packages/coding-agent/docs/environment-variables.md:85` | `PI_SKIP_VERSION_CHECK` 关闭 `pi.dev` 最新版本请求 | 该变量与读取它的启动检查已删除 |
| `packages/coding-agent/src/utils/version-check.ts`（源码文案） | 导出 `checkForNewPiVersion`，即读取 `PI_SKIP_VERSION_CHECK` 的启动检查 | 已删除；`getLatestPiRelease` 与 `isNewerPackageVersion` 保留供 `pi update --self` 使用 |
| `packages/coding-agent/docs/usage.md:23` | "Press `Ctrl+T` to show or hide thinking blocks" | `ctrl+t` 打开 Tab Jump；`app.thinking.toggle` 默认键不变，但 composer 在跳转处理器之后不再响应它 |
| `packages/coding-agent/docs/keybindings.md:157` | `app.thinking.toggle` 默认 `ctrl+t` | 同一个键属于 `app.tab.jump`，composer 先注册跳转处理器；thinking 开关需重新绑定后才可用 |
| `packages/coding-agent/docs/settings.md:79` | `fullscreenExitOutput` 取 `resume-hint` 时选择 "only a session resume hint" 作为退出输出 | 该取值仍然跳过退出时的对话记录输出，且不再打印任何内容 |

上面这些页面也都没有列出标签页键位和标签页斜杠命令 —— 包括 `/jump` 及其 `ctrl+t`；这些以 [Agent 标签页](tabs.zh.md) 为准。fork 重新绑定或新增的全部键位（按界面分类）集中在 [键位](keybindings.zh.md)。

## 本 fork 修改的上游文件

以下每一个都是潜在冲突点，因此改动要压缩到"调用 `mixcode/` 代码的接线"这一层：

- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`：fork 自有 `TabController`、
  `ExtensionUiController`、`ForkCommands`、`TurnController` 与 `TabUiHandover` 的接线。
  命令识别与被命令挤走的草稿归属 `ForkCommands`；撤回用的 run markers 与失败/settle
  反应位于 `TurnController`，在明确的事件位置调用。`TabUiHandover` 持有对话区缓存与预热、
  串行切换、绑定去重及延迟资源挂载。Home/对话区渲染、会话扩展绑定与核心状态渲染保留
  宿主接线。`ExtensionUiController` 持有每标签页的对话框、chrome、widget、自定义编辑器、
  输入订阅与进程级 waiting-for-input 计数。`--batch` 的启动接线（`initialBatch`，以及脚本无法加载时
  终止整条命令并恢复终端的收尾）也在本文件。
- `packages/coding-agent/src/core/agent-session-runtime.ts`：runtime 工厂接受恢复到其他工作目录的
  标签页提供的 project trust context
- `packages/coding-agent/src/config.ts`：`ENV_AGENT_DIR` / `ENV_SESSION_DIR` 固定为 `PI_*` 名称，不再跟随 `piConfig.name`
- `packages/coding-agent/src/utils/photon.ts`：通过 `getPackageDir()` 找到解压后的 Photon WASM
- `packages/tui/src/native-module-path.ts`：优先在 `PI_PACKAGE_DIR` 中查找原生模块，再回退到包和可执行文件旁
- `packages/coding-agent/src/modes/interactive/components/status-indicator.ts`：摘要模型标签与按压缩原因区分的文案颜色
- `packages/coding-agent/src/modes/interactive/components/session-selector.ts`
- `packages/coding-agent/src/modes/interactive/components/custom-editor.ts`
- `packages/coding-agent/src/modes/interactive/components/extension-selector.ts`：`keyShortcuts` 选项，以及扩展选择器上的 `y`/`n` 快捷键分支
- `packages/coding-agent/src/core/keybindings.ts`
- `packages/coding-agent/src/core/slash-commands.ts`
- `packages/coding-agent/src/core/extensions/runner.ts`
- `packages/coding-agent/src/modes/interactive/chat-viewport.ts`
- `packages/coding-agent/src/main.ts`：`MIXCODE` 宿主标记、`MIXCODE_PID` 里的宿主进程 pid、每标签 `EventBus` 的登记，以及以 `initialBatch` 或以 dry-run 计划到达交互模式的 `--batch` 调用
- `packages/coding-agent/src/core/session-manager.ts`：导出 `getDefaultSessionDirPath`
- `packages/coding-agent/src/index.ts`：为嵌入方再导出 `getDefaultSessionDirPath`
- `packages/coding-agent/src/core/agent-session.ts`：手动压缩请求独立指定模型，在 abort 当前轮次前就标记压缩已激活的 claim，steering 与 follow-up 队列的摘除，`/reset` 用的 `resetLeafToRoot()`，以及 `syncCacheWarmingMode()`（不写设置文件的 warming 重调）
- `packages/coding-agent/src/core/settings-manager.ts`：fork 的 fullscreen `tuiMode` 默认值，以及保留的覆盖层（`applyOverrides` 的覆盖在每次重新组合时都会保留，`clearOverrides` 释放指定字段）
- `packages/coding-agent/src/core/extensions/loader.ts`：让 bun 发行版的扩展导入走 `virtualModules`，并把 fork 自有的 `resolveJitiCacheDir()` 作为 jiti 的 `cache` 选项传进去
- `packages/coding-agent/src/modes/interactive/tui-renderer.ts`：把宿主的复制回调与选中选项转发给备用屏幕，并把区分 vim 页键的谓词传给备用屏幕，让 `pageUp`/`pageDown` 留在 vim 自己的 10 行滚动里
- fork 面板使用上游的 `toolPendingBg` 背景色；主题 token 与生成的主题 schema
  无需为面板背景增加 fork 扩展。
- `packages/coding-agent/test/extensions-runner.test.ts`
- `packages/coding-agent/test/interactive-tui.test.ts`：上游复制断言适配 fork 的 toast 行为；
  fork 专属的选区复制交接场景位于 `test/mixcode/clipboard.test.ts`；状态间距宿主补上
  `clearStatusIndicator` 会读取的 `homeSelection`
- `packages/coding-agent/src/modes/interactive/tui-renderer.ts`：指针位于跳到底部标签上时加下划线
- `packages/coding-agent/src/modes/interactive/components/tool-execution.ts`、`assistant-message.ts`、
  `compaction-summary-message.ts`、`branch-summary-message.ts`、`skill-invocation-message.ts`：可点击区域改用 fork 的 `HoverRegion`，框架自带的 `MouseRegion` 不会绘制高亮
- `packages/coding-agent/src/modes/interactive/components/user-message.ts`：消息首行右端的发送时间
- `packages/ai/src/api/openai-responses-shared.ts`：把 Responses 流中服务器报告的模型名记录到
  `AssistantMessage.responseModel`
- `packages/ai/src/api/anthropic-messages.ts`、`packages/ai/src/api/openai-completions.ts`：与 Responses 适配器共用同一个助手记录服务端报告的模型，让覆盖规则只有一处定义
- `packages/agent/src/agent.ts`：steering 与 follow-up 队列 API
- `packages/tui/src/components/editor.ts`、`packages/tui/src/editor-component.ts`：`setHistory` 可整体替换历史，且回召回的历史条目把光标放在末尾；`cursorVisible` 让被锁定的编辑器不画光标
- `packages/tui/src/layout-node.ts`：`LayoutNode` 联合里的 `WindowedLayoutNode` 分支，以及
  `ScrollLayoutState.consumeRelativeScrollDelta`：把上一次布局以来 `scrollBy` 请求的行数交给窗口化子组件
- `packages/tui/src/mixcode/windowed-node.ts`：窗口化布局状态与滚动行提供者，含 `renderWindow` 的
  `relativeDelta` 参数，供内容锚定的相对滚动解析
- `packages/tui/src/components/settings-list.ts`：`SettingItem` 的可选 `section` 标题行
- `packages/coding-agent/src/modes/interactive/components/settings-selector.ts`：`MixCode` 分组条目，`Fullscreen exit output` 的描述，以及面板在行变化后调用的 `onSettingsChanged` 钩子
- `packages/coding-agent/src/modes/interactive/theme/theme.ts`：`getSettingsListTheme` 的分组标题样式
- `packages/tui/src/layout.ts`：窗口化滚动子组件、滚动盒携带的行提供者、被挂起的滚动视图传给窗口化子组件的 `honorOffset` 参数、交给同一子组件的相对增量传递，以及已有高度的 `HStack` 拉伸子项跳过固有高度测量
- `packages/tui/src/mixcode/layout-queries.ts`：`getComponentBox`、滚动行提供者查询与物化整行的查询
- `packages/tui/src/components/scroll-view.ts`：`setFollowSuspended` / `isFollowSuspended` / `resumeFollowEnd`，让指针手势能钉住它正在选中的那些行；以及为窗口化子组件累积的 `scrollBy` 相对增量，绝对跳转与被夹死的请求会清掉它
- `packages/tui/src/tui.ts`：浮层鼠标派发会返回命中的浮层，以便区分“在浮层外”与“在浮层上”；把某一行解析到画出它的组件的 `Container.componentAtRow`、`hasCapturingOverlay`，以及区域解析所需的浮层矩形查询
- `packages/tui/src/mixcode/selection-types.ts`：`TuiSelectionOptions` 契约（含 `clearOnRelease` 与带绘制行信息的 `highlight`）
- `packages/tui/src/mixcode/child-at-row.ts`：`Container` 与 `Box` 共用的行到子组件命中测试
- `packages/tui/src/mixcode/settings-sections.ts`：列表渲染与命中测试共用的分组标题行计划
- `packages/tui/src/components/box.ts`：`componentAtRow`，让带内缩的卡片里的行也能解析到画出它的子组件
- `packages/tui/src/tui-alt-screen.ts`：经提供者读取内容行；选中操作只读取所需行，避免测量屏幕外历史时使指针的行坐标失效；`scrollToPrompt` 改为公开；
  `onCopyResult` 选项让宿主自行确认复制结果，替代该屏幕自带的一行 flash，并按 grapheme 数报告复制长度；
  跟踪被 hover 的组件，以便后续移动到别处、打开浮层或指针被捕获时向其发送 leave 事件；
  `scrollToEndIndicator` 会收到指针是否在标签上；`selection` 选项把拖拽限定到宿主公布的区域，并交给宿主做文本清洗、着色，以及在复制那次松手时清除高亮；
  `shouldDeferPageKeys` 谓词说明模态界面已接管输入，此时 `pageUp`/`pageDown` 交给焦点组件，让 vim 的翻页动作滚 10 行而不是整页
- `packages/tui/src/mixcode/text-metrics.ts`：`countGraphemes`，让 coding-agent 的 toast 能用同一单位报告复制长度
- `packages/tui/src/index.ts`：导出窗口化节点、鼠标派发、grapheme 计数器与图片行判定，以及选中选项
- `packages/coding-agent/src/cli/args.ts`：`--tui-mode` 帮助行写出 fork 的默认值
- `packages/coding-agent/test/settings-manager.test.ts`：TUI 模式断言改为 fork 的 fullscreen 默认值
- `packages/coding-agent/test/keybindings.test.ts`、`packages/coding-agent/test/interactive-mode-compaction.test.ts`：队列绑定与压缩路径
- `packages/coding-agent/test/interactive-mode-status.test.ts`：`showExtensionCustom` 用例给自建宿主补上按标签页作用域的协作者
- `packages/coding-agent/src/utils/version-check.ts`：删除 `checkForNewPiVersion`，启动提示是它唯一的调用方
- `scripts/build-coding-agent-bundle.mjs`：`fengari` 保持为 bundle 的外部依赖，并作为 Lua batch
  脚本所需的运行时包加入允许清单
- `scripts/profile-coding-agent-node.mjs`：`--offline` 不再设置已删除的 `PI_SKIP_VERSION_CHECK`
- `packages/coding-agent/test/version-check.test.ts`、`packages/coding-agent/test/package-command-paths.test.ts`：用例中去掉已删除的检查与对应环境变量；包管理夹具与输出断言通过 `APP_NAME` 使用 fork 的可执行文件名
- `packages/coding-agent/test/interactive-mode-startup-input.test.ts`：手工搭建的提交宿主补上输入分发前所需的 Home 挂载与 session 绑定
- `packages/coding-agent/test/suite/regressions/4167-thinking-toggle-pending-tool-render.test.ts`：测试宿主补上对话区渲染会调用的 response-model notice 回调
- `packages/coding-agent/test/suite/regressions/5080-signal-shutdown-extension-cleanup.test.ts`：随提示一并删掉恢复提示用例，保留它原本要覆盖的退出顺序
- `AGENTS.md`、`.gitignore`
- `packages/ai/src/types.ts`、`packages/ai/src/api/simple-options.ts`、`packages/ai/src/api/*` 下的十个文本适配器与 `packages/ai/src/providers/faux.ts`：`onProviderError` 流选项、它在 `streamSimple` 中的转发，以及每个终止 catch 里的一行 `notifyProviderError` 调用

本 fork 还给 `keybindings.ts` 加了键位绑定 —— 工作目录选择器响应的 `app.workdir.*`、排队消息编辑响应的 `app.queueEdit.*`，以及 Tab Jump 浮层响应的 `app.tab.jump` / `app.tabJump.toggleNonIdle`；`core/mixcode/multi-tab/tab-manager.ts` 与 `tab-state.ts` 是 fork 自有文件。

## 只存在于本 fork 的路径

上游不引用它们，因此永不冲突：

- `MIXCODE.md` —— fork 规则
- `MIXCODE_CHANGELOG.md` —— fork 改动记录
- `UPSTREAM.json` —— fork 所基于的上游版本
- `.agents/skills/` —— fork 专用 agent skill，包括[手动 TUI 演示](../.agents/skills/mixcode-manual-e2e/SKILL.md)
- `docs/` —— 本目录
- `test-all.sh`、`run.sh`、`install.sh` —— fork 测试入口、开发启动脚本与本地安装脚本
- `packages/*/src/**/mixcode/`、`packages/*/test/mixcode/`、`packages/tui/test/mixcode-*.test.ts` —— fork 代码与其测试
- [`packages/coding-agent/src/core/mixcode/multi-tab/mixcode-state.ts`](../packages/coding-agent/src/core/mixcode/multi-tab/mixcode-state.ts)：
  规范会话 ID 替换在发布成员列表之前复制有效的标题、颜色、工作目录与标题锁定元数据，
  并把 `activeSessionId` 映射到目标 ID。目标键已有的值优先，包括显式空值、`null` 与 `false`。
  只有目标尚未在打开的标签页集合中时，源 ID 的未读状态才会传给目标；已打开的目标保留自身
  的已读/未读决定。源 ID 的元数据别名与未知字段保留，存储格式不变。先获取 state 锁，再获取
  open-tabs 锁，两者共用原有的 5 秒锁等待预算；该预算不是包含文件 I/O 的总耗时上限。
- `packages/coding-agent/src/modes/interactive/components/clickable-card.ts` —— 位于 `mixcode/` 目录之外的 fork 模块
