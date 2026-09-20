import type { DisputeDraft } from './cases'

export const AGREEMENT_VERSION = 'equiverdict-agreement-v1'

// Explicit, ordered keys and normalized wallets make the exact accepted bytes reproducible.
export function canonicalAgreement(draft: DisputeDraft, clientWallet: string): string {
  return JSON.stringify({
    amount: draft.amount.trim(),
    caseId: draft.caseId.trim(),
    category: draft.category.trim(),
    clientName: draft.clientName.trim(),
    clientWallet: clientWallet.toLowerCase(),
    freelancerName: draft.freelancerName.trim(),
    freelancerWallet: draft.freelancerWallet.trim().toLowerCase(),
    summary: draft.summary.trim(),
    terms: draft.terms.trim(),
    title: draft.title.trim(),
    version: AGREEMENT_VERSION,
  })
}

export async function agreementSha256(agreement: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(agreement))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
