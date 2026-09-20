import { createHash } from 'node:crypto'
import { canonicalAgreement } from '../../app/lib/agreement.ts'

export const client = '0x' + '11'.repeat(20)
export const freelancer = '0x' + '22'.repeat(20)
export const outsider = '0x' + '33'.repeat(20)
export const draft = { caseId: 'case-1', title: 'Delivery', category: 'Scope', summary: 'Partial delivery', terms: 'Deliver two milestones.', clientName: 'Client', freelancerName: 'Freelancer', freelancerWallet: freelancer, amount: '100' }
export function record() {
  const agreement = canonicalAgreement(draft, client)
  return {
    case_id: draft.caseId, agreement, agreement_sha256: createHash('sha256').update(agreement).digest('hex'),
    client_wallet: client, freelancer_wallet: freelancer, disputed_amount: '100',
    client_agreement_accepted: false, freelancer_agreement_accepted: false, agreement_status: 'awaiting_acceptance',
    status: 'collecting_evidence', evidence_frozen: false, evidence_root: '', evidence_order: [],
    client_evidence: [], freelancer_evidence: [], verdict: {},
  }
}
export function evidence(role, id) {
  return { evidence_id: id, role, submitting_wallet: role === 'client' ? client : freelancer,
    evidence_type: 'document', title: 'Delivery log', description: 'Half delivered', importance: 'high', timestamp: '2026-09-19',
    evidence_uri: 'https://example.test/proof.txt', evidence_sha256: 'a'.repeat(64), provenance_sha256: 'b'.repeat(64), agreement_sha256: record().agreement_sha256 }
}
