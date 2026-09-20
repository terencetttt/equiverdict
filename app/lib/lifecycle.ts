import type { DisputeCase } from './cases'

export function disputeActions(record: DisputeCase | null, wallet: string, pending = false) {
  const address = wallet.toLowerCase()
  const role = address && address === record?.clientWallet.toLowerCase() ? 'client'
    : address && address === record?.freelancerWallet.toLowerCase() ? 'freelancer' : null
  const mutuallyAccepted = Boolean(record?.clientAgreementAccepted && record?.freelancerAgreementAccepted && record?.agreementStatus === 'mutually_accepted')
  const finished = record?.status === 'evaluated'
  const frozen = Boolean(record?.evidenceFrozen)
  const allowed = Boolean(record && role && !pending && !finished && record.agreementSha256)
  const accepted = role === 'client' ? record?.clientAgreementAccepted : role === 'freelancer' ? record?.freelancerAgreementAccepted : false
  const bothHaveEvidence = Boolean(record?.evidence.some((item) => item.role === 'client') && record.evidence.some((item) => item.role === 'freelancer'))
  return {
    role, mutuallyAccepted,
    canAccept: allowed && !accepted && !frozen,
    canSubmit: allowed && mutuallyAccepted && !frozen,
    canFreeze: allowed && mutuallyAccepted && bothHaveEvidence && !frozen,
    canEvaluate: allowed && mutuallyAccepted && frozen && bothHaveEvidence && Boolean(record?.evidenceRoot),
  }
}
