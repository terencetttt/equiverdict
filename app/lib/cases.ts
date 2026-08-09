export type EvidenceRole = 'client' | 'freelancer' | 'arbiter'

export interface EvidenceItem {
  id: string
  type: string
  title: string
  summary: string
  role: EvidenceRole
  importance: string
  timestamp: string
  url: string
}

export interface DisputeCase {
  id: string
  title: string
  summary: string
  category: string
  amount: string
  client: string
  freelancer: string
  createdAt: string
  status: string
  badge: 'pending' | 'review' | 'resolved'
  evidence: EvidenceItem[]
  verdict: VerdictResult
  submittedBy: string
}

export interface VerdictResult {
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
  caseId: string
  title: string
  category: string
  summary: string
  clientName: string
  freelancerName: string
  amount: string
}

type ContractEvidence = {
  type?: string
  role?: EvidenceRole
  title?: string
  summary?: string
  importance?: string
  timestamp?: string
  url?: string
}

type ContractDispute = {
  case_id?: string
  agreement?: string
  disputed_amount?: string
  status?: string
  submitted_by?: string
  client_evidence?: ContractEvidence[]
  freelancer_evidence?: ContractEvidence[]
  verdict?: {
    decision_label?: string
    confidence_score?: number
    recommended_next_step?: string
    explanation?: string[]
    payment_split?: { client?: number; freelancer?: number }
  }
}

export const DISPUTE_DRAFT_KEY = 'equiverdict:dispute-draft'

export function mapContractDispute(record: unknown): DisputeCase {
  const raw = record as ContractDispute
  let agreement: Partial<DisputeDraft> = {}

  try {
    agreement = JSON.parse(raw.agreement ?? '{}') as Partial<DisputeDraft>
  } catch {
    agreement = { summary: raw.agreement ?? '' }
  }

  const allEvidence = [...(raw.client_evidence ?? []), ...(raw.freelancer_evidence ?? [])]
  const caseId = raw.case_id ?? agreement.caseId ?? ''
  const status = raw.status ?? 'submitted'

  return {
    id: caseId,
    title: agreement.title ?? caseId,
    summary: agreement.summary ?? '',
    category: agreement.category ?? 'Freelance services',
    amount: raw.disputed_amount ?? agreement.amount ?? '',
    client: agreement.clientName ?? 'Client',
    freelancer: agreement.freelancerName ?? 'Freelancer',
    createdAt: allEvidence[0]?.timestamp?.slice(0, 10) ?? '',
    status,
    badge: status === 'evaluated' ? 'resolved' : status === 'submitted' ? 'review' : 'pending',
    evidence: allEvidence.map((item, index) => ({
      id: `${caseId}-evidence-${index}`,
      type: item.type ?? 'evidence',
      title: item.title ?? 'Evidence',
      summary: item.summary ?? '',
      role: item.role ?? 'client',
      importance: item.importance ?? 'medium',
      timestamp: item.timestamp ?? '',
      url: item.url ?? '',
    })),
    verdict: {
      decisionLabel: raw.verdict?.decision_label ?? 'Pending review',
      confidenceScore: raw.verdict?.confidence_score ?? 0,
      recommendedNextStep: raw.verdict?.recommended_next_step ?? 'await_review',
      explanation: raw.verdict?.explanation ?? [],
      paymentSplit: {
        client: raw.verdict?.payment_split?.client ?? 0,
        freelancer: raw.verdict?.payment_split?.freelancer ?? 0,
      },
    },
    submittedBy: raw.submitted_by ?? '',
  }
}
