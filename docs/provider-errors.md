# Provider Error Diagnostics

[中文文档](provider-errors.zh.md)

A model request that fails inside a built-in adapter decides its `errorMessage` from the provider's
own formatting, which keeps the message a user can act on but drops everything else the exception
carried. The fork records the rest as a diagnostic line: the exception's type, its code, and its
HTTP status, with nothing that could hold caller data.

## Reading a failure

Open `/console-history` after a request failed. Each recorded failure is one `console.warn` line:

```text
2026-10-02 09:12:44 [agent-2] [console.warn]: [provider-error] {"provider":"custom","model":"example","api":"openai-completions","errors":[{"name":"APIConnectionError"},{"name":"Error","code":"ENOTFOUND"}]}
```

`errors` lists up to five exception nodes, root first, following `cause` and `AggregateError.errors`
with cycle protection. A node contributes only what it actually carries:

- `name` and `code`, each accepted only as `[a-zA-Z][a-zA-Z0-9_.-]{0,79}`. A control character, a
  space, or a token shaped like a credential is dropped.
- `status`, an integer from 100 through 599. When a node has no `status`, the AWS
  `$metadata.httpStatusCode` is read instead. Anything outside the range is dropped.

A node with none of the three is omitted. Exception messages, stacks, request headers, response
bodies and credential fields never reach the line, so it is safe to paste into a bug report.

Records stay in the process-local console history: they are not added to session messages and not
written to a log file. A request cancelled by its caller still reaches the caller's own observer but
produces no diagnostic line. See [Console History](console-history.md) for the panel and
`/console-history`.

## The `onProviderError` observer

`StreamOptions` and `SimpleStreamOptions` accept an optional observer:

```ts
onProviderError?: (error: unknown, model: Model<Api>) => void;
```

An adapter calls it with the caught exception before it formats the terminal error, once per
terminal failure, including a caught abort. A retry that recovers does not call it; exhausted
adapter retries call it once; an error result the adapter produces without a thrown exception does
not call it. A host-level retry starts a separate request and may report again. The exception keeps
the `cause` the SDK supplied.

`error` and `model` are borrowed references: treat both as read-only. The call is synchronous and
its return value is not awaited, and a throw or a rejected promise is swallowed, so an observer
cannot replace the provider's own failure or strand the stream. Redacting and storing the raw
values is the observer's job.

Coverage is every built-in text adapter: Anthropic Messages, OpenAI Chat Completions, OpenAI
Responses, Azure Responses, Codex Responses, Google Generative AI, Google Vertex, Bedrock Converse,
Mistral Conversations, Pi Messages, and exceptions thrown by a faux response function. Image
generation, deferred operations, authentication or lazy setup failures before the adapter runs, and
error results without a thrown exception are outside the observer. A provider registered by an
extension must call the observer itself when it catches an exception.

## What the fork installs

The interactive app installs the diagnostic observer on the shared `ModelRuntime` it creates for a
working directory, so every agent turn and every compaction request through that runtime is
covered; `complete` and `completeSimple` delegate to the wrapped `stream` and `streamSimple`. A
runtime created by another entry point (the SDK, an experimental worker) is not instrumented.

Each request keeps its own caller observer, and the diagnostic line is written after the caller's
observer has run inside its own isolation, so a throwing caller cannot suppress it.
