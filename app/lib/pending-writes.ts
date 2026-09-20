import type { ExpectedTransition } from './reconciliation'
import { publishState } from './state-events'

export type PendingWrite = { hash: string; contract: string; account: string; method: string; caseId: string; expected?: ExpectedTransition; timedOut?: boolean }
const pending = new Map<string, PendingWrite>()
const submitting = new Map<string, Promise<`0x${string}`>>()
const prefix = 'equiverdict:pending:studionet:'

function readEntries() {
  if (typeof sessionStorage !== 'undefined') {
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)
        if (!key?.startsWith(prefix) || pending.has(key.slice(prefix.length))) continue
        const [contract, account, method, caseId] = JSON.parse(key.slice(prefix.length))
        const value = sessionStorage.getItem(key) || ''
        const entry = value.startsWith('0x') ? { hash: value, contract, account, method, caseId } : JSON.parse(value)
        if (/^0x[0-9a-fA-F]{64}$/.test(entry.hash)) pending.set(key.slice(prefix.length), entry)
      }
    } catch { /* An unavailable session store must not break live in-memory recovery. */ }
  }
}
function save(key: string, entry: PendingWrite) {
  pending.set(key, entry)
  try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(prefix + key, JSON.stringify(entry)) } catch { /* Retain in memory. */ }
  publishState({ type: 'pending', caseId: entry.caseId })
}
export async function submitOnce(key: string, submit: () => Promise<`0x${string}`>, expected?: ExpectedTransition) {
  readEntries()
  const stored = pending.get(key)
  if (stored) return stored.hash as `0x${string}`
  const existing = submitting.get(key)
  if (existing) return existing
  const work = (async () => {
    const hash = await submit()
    const [contract, account, method, caseId] = JSON.parse(key)
    save(key, { hash, contract, account, method, caseId, expected })
    return hash
  })()
  submitting.set(key, work)
  try { return await work } finally { submitting.delete(key) }
}
export function clearPending(hash: string) {
  readEntries()
  for (const [key, entry] of pending) if (entry.hash === hash) {
    pending.delete(key)
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(prefix + key) } catch { /* In-memory state remains authoritative. */ }
    publishState({ type: 'pending', caseId: entry.caseId })
  }
}
export function markPendingTimeout(hash: string, timedOut = true) {
  readEntries()
  for (const [key, entry] of pending) if (entry.hash === hash) save(key, { ...entry, timedOut })
}
export function pendingTransactions(): PendingWrite[] { readEntries(); return [...pending.values()] }
