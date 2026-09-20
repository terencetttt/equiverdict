import type { DisputeCase, EvidenceSubmission } from './cases'

export type ExpectedTransition = {
  method: string
  caseId: string
  account: string
  agreement?: string
  agreementHash?: string
  otherAccepted?: boolean
  evidence?: EvidenceSubmission
  previousEvidenceIds?: string[]
}

export class ReconciliationTimeout extends Error {
  constructor(public readonly transactionHash: string) {
    super(`Confirmation is taking longer than expected. Transaction ${transactionHash} is saved. Use Check status; do not submit again.`)
    this.name = 'ReconciliationTimeout'
  }
}

export function transitionObserved(record: DisputeCase, expected: ExpectedTransition) {
  if (record.id !== expected.caseId) return false
  const account = expected.account.toLowerCase()
  const role = record.clientWallet.toLowerCase() === account ? 'client'
    : record.freelancerWallet.toLowerCase() === account ? 'freelancer' : null
  if (!role) return false
  if (expected.agreementHash && record.agreementSha256 !== expected.agreementHash) return false
  switch (expected.method) {
    case 'create_dispute': return role === 'client' && (!expected.agreement || record.agreement === expected.agreement)
    case 'accept_agreement': {
      const ownAccepted = role === 'client' ? record.clientAgreementAccepted : record.freelancerAgreementAccepted
      const both = record.clientAgreementAccepted && record.freelancerAgreementAccepted
      return ownAccepted && (!(expected.otherAccepted || both) || (both && record.agreementStatus === 'mutually_accepted'))
    }
    case 'submit_evidence': return Boolean(expected.evidence && record.evidence.some(item =>
      item.role === role && item.submittingWallet.toLowerCase() === account
      && item.id && !expected.previousEvidenceIds?.includes(item.id)
      && item.evidenceSha256.toLowerCase() === expected.evidence!.evidenceSha256.toLowerCase()
      && item.url === expected.evidence!.url && item.agreementSha256 === expected.evidence!.acceptedAgreementSha256
      && item.type === expected.evidence!.type && item.title === expected.evidence!.title
      && item.summary === expected.evidence!.summary && item.importance === expected.evidence!.importance
      && item.timestamp === expected.evidence!.timestamp))
    case 'freeze_evidence': return record.evidenceFrozen && Boolean(record.evidenceRoot)
    case 'evaluate_dispute': return record.status === 'evaluated' && Boolean(record.verdict.outcome)
      && record.verdict.explanation.length > 0
    default: return false
  }
}

export async function boundedRead<T>(read: () => Promise<T>, timeoutMs = 10000, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    signal?.throwIfAborted()
    return await Promise.race([read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Contract read timed out')), timeoutMs)
      abort = () => reject(signal?.reason)
      signal?.addEventListener('abort', abort, { once: true })
    })])
  } finally { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort) }
}

export async function reconcileTransition({ hash, expected, read, observeReceipt, attempts = 60, intervalMs = 2000, timeoutMs = 180000, signal }: {
  hash: string
  expected: ExpectedTransition
  read: () => Promise<DisputeCase>
  observeReceipt?: () => Promise<unknown>
  attempts?: number
  intervalMs?: number
  timeoutMs?: number
  signal?: AbortSignal
}) {
  const deadline = Date.now() + timeoutMs
  // Receipt diagnostics are advisory and cannot delay or veto contract proof.
  if (observeReceipt) void observeReceipt().catch(() => undefined)
  for (let attempt = 0; attempt < attempts && Date.now() < deadline; attempt++) {
    signal?.throwIfAborted()
    try {
      const record = await boundedRead(read, Math.min(10000, Math.max(1, deadline - Date.now())), signal)
      if (transitionObserved(record, expected)) return record
    } catch { signal?.throwIfAborted() /* Transient read failures keep the saved hash. */ }
    if (attempt + 1 < attempts && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, deadline - Date.now())))
    }
  }
  throw new ReconciliationTimeout(hash)
}
