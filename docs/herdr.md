# Herdr Pane Reporting

[中文文档](herdr.zh.md)

An `mpi` running inside a [Herdr](https://herdr.dev) pane reports the pane's agent state, so the
Herdr sidebar, `herdr agent list` and `herdr agent get` can tell a working agent from an idle one.

The reporter is the `mpi-herdr-report` extension under `<agent dir>/extensions/`. This fork does not
ship one of its own; it supplies the host side the extension listens to, the same way MixCode Pi
does. A machine that never installed the extension gets no reporting.

## Host identity

`main()` sets `process.env.MIXCODE ??= "1"` before any extension loads. An extension that exists only
for this host (the Herdr reporter is one) gates on that variable, so it stays silent in an upstream
`pi` process that loads the same packages. An explicitly set `0` / `false` / `off` is left alone.

## Channels

Each tab's resource loader builds its own `EventBus`; every extension loaded into that tab receives it
as `pi.events`. A signal that concerns the whole process has to reach all of them, so the fork keeps
the buses in a process-wide registry (`core/mixcode/extension-event-bus.ts`) and re-emits on each:

| Channel | Payload | Emitted when |
| --- | --- | --- |
| `mpi:waiting-for-input` | `{count, active}` | the number of extension dialogs waiting on a human changes |
| `mpi:mark-done` | `{reason: "command"}` | 5 seconds after `/mark-done` |

`count` is the sum over every open tab's pending extension dialogs, so a dialog opened in a
background tab still counts. The dialog's kind can be any of `select`, `confirm`, `input`, `editor`
or `custom`, and nested dialogs each count.

`/mark-done` still refuses while the tab is loading or working. When it does run, the signal waits
5 seconds, because hosts commonly treat `done` as idle-plus-unseen and the user needs time to leave
the pane first.

## Registration

A tab's bus is created in `main()`'s runtime factory, handed to the loader through
`resourceLoaderOptions.eventBus`, and registered as soon as the tab's services exist. Closing a tab
or disposing the app unregisters it, so a closed tab's `pi.events` receives nothing afterwards.

## Upstream difference

Upstream pi sets no host marker and broadcasts neither channel, so an extension like
`mpi-herdr-report` cannot work there. Nothing here changes the fork's behavior without that
extension loaded: the two channels have no listeners of their own. See
[Upstream Drift](upstream-drift.md).
