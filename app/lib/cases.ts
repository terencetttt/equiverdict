export type EvidenceRole = 'client' | 'freelancer'

export interface EvidenceItem {
  id: string
  type: string
  title: string
  summary: string
  role: EvidenceRole
  importance: string
  timestamp: string
  url: string
  evidenceSha256: string
  provenanceSha256: string
  agreementSha256: string
  submittingWallet: string
}

export interface EvidenceSubmission {
  acceptedAgreementSha256: string
  type: string
  title: string
  summary: string
  importance: string
  timestamp: string
  url: string
  evidenceSha256: string
}

export interface DisputeCase {
  id: string
  title: string
  summary: string
  category: string
  amount: string
  client: string
  freelancer: string
  clientWallet: string
  freelancerWallet: string
  agreement: string
  agreementVersion: string
  agreementSha256: string
  clientAgreementAccepted: boolean
  freelancerAgreementAccepted: boolean
  agreementStatus: string
  evidenceFrozen: boolean
  evidenceRoot: string
  createdAt: string
  status: string
  badge: 'pending' | 'review' | 'resolved'
  evidence: EvidenceItem[]
  verdict: VerdictResult
  submittedBy: string
  evaluatedBy: string
}

export interface VerdictResult {
  outcome: string
  materialFindings: { finding: string; evidenceIds: string[] }[]
  decisionLabel: string
  confidenceScore: number
  recommendedNextStep: string
  explanation: string[]
  paymentSplit: {
    client: number
    freelancer: number
  }
}

export interface DisputeDraft {
  terms: string
  caseId: string
  title: string
  category: string
  summary: string
  clientName: string
  freelancerName: string
  freelancerWallet: string
  amount: string
}

type ContractEvidence = {
  evidence_id?: string
  provenance_sha256?: string
  agreement_sha256?: string
  evidence_type?: string
  title?: string
  description?: string
  importance?: string
  timestamp?: string
  evidence_uri?: string
  evidence_sha256?: string
  submitting_wallet?: string
  role?: EvidenceRole
}

type ContractDispute = {
  agreement_sha256?: string
  client_agreement_accepted?: boolean
  freelancer_agreement_accepted?: boolean
  agreement_status?: string
  evidence_frozen?: boolean
  evidence_root?: string
  evidence_order?: string[]
  case_id?: string
  agreement?: string
  disputed_amount?: string
  status?: string
  submitted_by?: string
  evaluated_by?: string
  client_wallet?: string
  freelancer_wallet?: string
  client_evidence?: ContractEvidence[]
  freelancer_evidence?: ContractEvidence[]
  verdict?: {
    verdict_category?: string
    material_findings?: { finding: string; evidence_ids: string[] }[]
    decision_label?: string
    confidence_score?: number
    recommended_next_step?: string
    explanation?: string | string[]
    payment_split?: { client?: number; freelancer?: number }
  }
}

export const DISPUTE_DRAFT_KEY = 'equiverdict:dispute-draft'

export function mapContractDispute(record: unknown): DisputeCase {
  const raw = record as ContractDispute
  let agreement: Partial<DisputeDraft> & { version?: string } = {}

  try {
    const parsed: unknown = JSON.parse(raw.agreement ?? '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) agreement = parsed as typeof agreement
  } catch {
    agreement = { summary: raw.agreement ?? '' }
  }

  const allEvidence = [
    ...(raw.client_evidence ?? []).map((item) => ({ ...item, role: 'client' as const })),
    ...(raw.freelancer_evidence ?? []).map((item) => ({ ...item, role: 'freelancer' as const })),
  ]
  if (raw.evidence_order) {
    const order = new Map(raw.evidence_order.map((id, index) => [id, index]))
    allEvidence.sort((a, b) => (order.get(a.evidence_id ?? '') ?? Infinity) - (order.get(b.evidence_id ?? '') ?? Infinity))
  }
  const caseId = raw.case_id ?? agreement.caseId ?? ''
  const status = raw.status ?? 'collecting_evidence'

  return {
    id: caseId,
    title: agreement.title ?? caseId,
    summary: agreement.summary ?? '',
    category: agreement.category ?? 'Freelance services',
    amount: raw.disputed_amount ?? agreement.amount ?? '',
    client: agreement.clientName ?? 'Client',
    freelancer: agreement.freelancerName ?? 'Freelancer',
    clientWallet: raw.client_wallet ?? '',
    freelancerWallet: raw.freelancer_wallet ?? agreement.freelancerWallet ?? '',
    agreement: raw.agreement ?? '',
    agreementVersion: agreement.version ?? 'Unversioned / historical',
    agreementSha256: raw.agreement_sha256 ?? '',
    clientAgreementAccepted: raw.client_agreement_accepted === true,
    freelancerAgreementAccepted: raw.freelancer_agreement_accepted === true,
    agreementStatus: raw.agreement_status ?? 'unknown',
    evidenceFrozen: raw.evidence_frozen === true,
    evidenceRoot: raw.evidence_root ?? '',
    createdAt: allEvidence[0]?.timestamp?.slice(0, 10) ?? '',
    status,
    badge: status === 'evaluated' ? 'resolved' : ['evidence_ready', 'evidence_frozen'].includes(status) ? 'review' : 'pending',
    evidence: allEvidence.map((item) => ({
      id: item.evidence_id ?? '',
      type: item.evidence_type ?? 'evidence',
      title: item.title ?? 'Evidence',
      summary: item.description ?? '',
      role: item.role ?? 'client',
      importance: item.importance ?? 'medium',
      timestamp: item.timestamp ?? '',
      url: item.evidence_uri ?? '',
      evidenceSha256: item.evidence_sha256 ?? '',
      provenanceSha256: item.provenance_sha256 ?? '',
      agreementSha256: item.agreement_sha256 ?? '',
      submittingWallet: item.submitting_wallet ?? '',
    })),
    verdict: {
      outcome: raw.verdict?.verdict_category ?? '',
      materialFindings: (raw.verdict?.material_findings ?? []).map((item) => ({ finding: item.finding, evidenceIds: item.evidence_ids })),
      decisionLabel: raw.verdict?.decision_label ?? 'Pending review',
      confidenceScore: raw.verdict?.confidence_score ?? 0,
      recommendedNextStep: raw.verdict?.recommended_next_step ?? 'await_review',
      explanation: Array.isArray(raw.verdict?.explanation)
        ? raw.verdict.explanation
        : raw.verdict?.explanation
          ? [raw.verdict.explanation]
          : [],
      paymentSplit: {
        client: raw.verdict?.payment_split?.client ?? 0,
        freelancer: raw.verdict?.payment_split?.freelancer ?? 0,
      },
    },
    submittedBy: raw.submitted_by ?? '',
    evaluatedBy: raw.evaluated_by ?? '',
  }
}
