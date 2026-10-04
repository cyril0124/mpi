/**
 * Process-wide fan-out over the extension `EventBus` instances.
 *
 * Each tab's resource loader creates its own bus and hands it to every extension
 * as `pi.events`, so a host signal that concerns the whole process (how many
 * dialogs wait on a human, an explicit mark-done) has to reach all of them.
 * Host code calls the setters here; every registered bus re-emits.
 */

import type { EventBus } from "../event-bus.ts";

/** Public `pi.events` channel for the WaitingForInput count. */
export const WAITING_FOR_INPUT_EVENT = "mpi:waiting-for-input" as const;

/** Public `pi.events` channel for an explicit user mark-done. */
export const MARK_DONE_EVENT = "mpi:mark-done" as const;

/** Payload of `mpi:waiting-for-input`: how many dialogs wait, and whether any do. */
export interface WaitingForInputEventPayload {
	count: number;
	active: boolean;
}

/** Payload of `mpi:mark-done`. Only the command raises it today. */
interface MarkDoneEventPayload {
	reason: "command";
}

const buses = new Set<EventBus>();
const busByServices = new WeakMap<object, EventBus>();

/** Register the bus already installed on the resource loader for this services object. */
export function registerExtensionEventBus(services: object, bus: EventBus): void {
	const previous = busByServices.get(services);
	if (previous && previous !== bus) {
		buses.delete(previous);
	}
	buses.add(bus);
	busByServices.set(services, bus);
}

/** Drop the registration a services object made, so its bus stops receiving broadcasts. */
export function unregisterExtensionEventBus(services: object): void {
	const bus = busByServices.get(services);
	if (!bus) return;
	buses.delete(bus);
	busByServices.delete(services);
}

/** Broadcast the process-wide WaitingForInput count. Callers pass the current sum. */
export function setWaitingForInputCount(rawCount: number): void {
	const count = Math.max(0, rawCount);
	broadcast(WAITING_FOR_INPUT_EVENT, { count, active: count > 0 } satisfies WaitingForInputEventPayload);
}

/**
 * Broadcast an explicit mark-done (`/mark-done`). Callers that want the user to
 * be able to leave the pane first delay this, since some hosts map `done` to
 * idle-plus-unseen.
 */
export function emitMarkDone(payload: MarkDoneEventPayload = { reason: "command" }): void {
	broadcast(MARK_DONE_EVENT, payload);
}

function broadcast(channel: string, payload: unknown): void {
	for (const bus of buses) {
		bus.emit(channel, payload);
	}
}
