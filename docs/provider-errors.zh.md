# 模型请求错误诊断

[English Documentation](provider-errors.md)

内置适配器里失败的模型请求，其 `errorMessage` 由 provider 自己的格式化决定：用户能看懂的那句话留下来了，异常携带的其余信息被丢掉。本 fork 把其余部分记成一行诊断：异常类型、错误码与 HTTP 状态，且不含任何可能带用户数据的内容。

## 查看一次失败

请求失败后打开 `/console-history`，每次失败记录为一行 `console.warn`：

```text
2026-10-02 09:12:44 [agent-2] [console.warn]: [provider-error] {"provider":"custom","model":"example","api":"openai-completions","errors":[{"name":"APIConnectionError"},{"name":"Error","code":"ENOTFOUND"}]}
```

`errors` 最多列出五个异常节点，根节点在前，沿 `cause` 与 `AggregateError.errors` 展开并防止循环引用。节点只贡献它真正携带的字段：

- `name` 与 `code`：仅接受匹配 `[a-zA-Z][a-zA-Z0-9_.-]{0,79}` 的字符串。控制字符、空格，或形似凭证的串都会被丢弃。
- `status`：100 至 599 的整数。节点没有 `status` 时改读 AWS 的 `$metadata.httpStatusCode`，超出范围同样丢弃。

三项都没有的节点会被省略。异常消息、堆栈、请求头、响应体与凭证字段都不会进入这一行，因此可以安全粘进 issue。

记录只留在进程内的控制台历史里：不会写进会话消息，也不会写入单独的日志文件。被调用方取消的请求仍会送达调用方自己的观察者，但不产生诊断行。弹窗与 `/console-history` 见[控制台历史](console-history.zh.md)。

## `onProviderError` 观察者

`StreamOptions` 与 `SimpleStreamOptions` 接受一个可选观察者：

```ts
onProviderError?: (error: unknown, model: Model<Api>) => void;
```

适配器在格式化最终错误之前，把捕获到的异常交给它，每次最终失败调用一次（包括被捕获的取消）。重试成功恢复时不调用；适配器重试耗尽时调用一次；未抛出异常、直接产出错误结果时不调用。宿主层重试会发起另一个请求，可能再次上报。异常保留 SDK 提供的 `cause`。

`error` 与 `model` 是借用引用，都按只读值处理。回调同步执行，返回值不被等待；抛错或 Promise 拒绝会被吞掉，因此观察者无法替换 provider 自己的失败结果，也不会让流悬停。原始对象的脱敏与存储由观察者负责。

覆盖范围为全部内置文本适配器：Anthropic Messages、OpenAI Chat Completions、OpenAI Responses、Azure Responses、Codex Responses、Google Generative AI、Google Vertex、Bedrock Converse、Mistral Conversations、Pi Messages，以及 faux 响应函数抛出的异常。图片生成、deferred 操作、进入适配器之前的认证或懒加载失败，以及未抛出异常的错误结果不在范围内。扩展注册的 provider 需要在捕获异常时自行调用观察者。

## fork 安装在哪

交互模式把诊断观察者装到它按工作目录创建的共享 `ModelRuntime` 上，因此经由该运行时的 agent 回合与压缩请求都被覆盖；`complete` 与 `completeSimple` 委托给被包装的 `stream` 与 `streamSimple`。由其他入口（SDK、实验性 worker）创建的运行时不会安装。

每个请求保留自己的调用方观察者；诊断行在调用方观察者于各自的隔离中执行之后才写，因此调用方抛错不会抑制诊断行。
