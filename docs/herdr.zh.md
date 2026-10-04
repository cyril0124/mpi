# Herdr 窗格上报

[English Documentation](herdr.md)

运行在 [Herdr](https://herdr.dev) 窗格内的 `mpi` 会上报该窗格的 Agent 状态，让 Herdr 侧边栏、`herdr agent list` 与 `herdr agent get` 能区分工作中与空闲的 Agent。

上报器是 `<agent dir>/extensions/` 下的 `mpi-herdr-report` 扩展。本 fork 不自带 reporter，只提供它监听的宿主信号，做法与 MixCode Pi 一致。从未装过该扩展的机器不会有上报。

## 宿主身份

`main()` 在任何扩展加载之前设置 `process.env.MIXCODE ??= "1"`。只属于本宿主的扩展（Herdr 上报器就是其一）以此变量为开关，因此加载同一批包的上游 `pi` 进程里它会保持静默。显式设置的 `0` / `false` / `off` 不会被覆盖。

## 通道

每个标签的资源加载器各自创建一个 `EventBus`，该标签里的每个扩展都通过 `pi.events` 拿到它。涉及整个进程的信号必须抵达所有这些实例，因此 fork 用一张进程级登记表（`core/mixcode/extension-event-bus.ts`）保存这些 bus，并逐个重发：

| 通道 | 载荷 | 触发时机 |
| --- | --- | --- |
| `mpi:waiting-for-input` | `{count, active}` | 等待人类输入的扩展对话框数量发生变化时 |
| `mpi:mark-done` | `{reason: "command"}` | `/mark-done` 之后 5 秒 |

`count` 是所有已打开标签中待处理扩展对话框的总数，因此后台标签里打开的对话框同样计入。对话框种类可以是 `select`、`confirm`、`input`、`editor` 或 `custom`，嵌套对话框各计一次。

`/mark-done` 在标签仍在加载或工作时依然拒绝执行。真正执行时，信号延迟 5 秒发出，因为外部宿主通常把 `done` 当作"空闲且未查看"，用户需要时间先离开该窗格。

## 注册

标签的 bus 在 `main()` 的运行时工厂里创建，通过 `resourceLoaderOptions.eventBus` 交给加载器，并在该标签的服务创建完成后登记。关闭标签或销毁应用时注销，因此已关闭标签的 `pi.events` 之后不会再收到任何广播。

## 与上游的差异

上游 pi 既不设置宿主标记，也不广播这两个通道，因此像 `mpi-herdr-report` 这样的扩展在上游无法工作。未加载该扩展时这里不改变 fork 的任何行为：两个通道本身没有监听者。见[上游差异](upstream-drift.zh.md)。
