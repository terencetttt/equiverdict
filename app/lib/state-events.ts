import type { DisputeCase } from './cases'
export type StateEvent = { type: 'wallet' | 'pending' | 'confirmed'; caseId?: string; method?: string; hash?: string; record?: DisputeCase }
const listeners = new Set<(event: StateEvent) => void>()
export function subscribeState(listener: (event: StateEvent) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function publishState(event: StateEvent) {
  for (const listener of listeners) listener(event)
}
