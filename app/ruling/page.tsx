'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback } from 'react'
import { DisputeCase } from '../lib/cases'
import { getDispute, listDisputes } from '../lib/genlayer'
import { useLiveResource } from '../lib/use-live-state'
import { MaterialFindings } from '../components/DisputeRecords'

function RulingContent() {
  const caseId = useSearchParams().get('case')
  const load = useCallback(() => caseId ? getDispute(caseId)
    : listDisputes().then(items => items.length ? items[items.length - 1] : null), [caseId])
  const { data: caseRecord, loading, error } = useLiveResource<DisputeCase | null>(caseId || 'latest-ruling', load, null)

  if (loading) return <section className="panel"><div className="notice"><h3>Loading ruling…</h3><p>Reading the Studionet contract.</p></div></section>
  if (!caseRecord) return <section className="panel"><div className="notice error-text"><h3>Ruling unavailable</h3><p>{error || 'No on-chain disputes are available.'}</p><Link href="/dashboard"><button className="secondary">Back to dashboard</button></Link></div></section>

  if (caseRecord.status !== 'evaluated') return <section className="panel"><div className="notice"><h3>No final verdict yet</h3><Link href={`/dispute/submit?case=${encodeURIComponent(caseRecord.id)}`}>Continue the case lifecycle</Link></div></section>

  const verdict = caseRecord.verdict
  return (
    <section className="panel soft-panel">
      <div className="heading-row"><div><p className="eyebrow">Ruling</p><h2>Payment recommendation</h2></div></div>
      <div className="result-grid"><article className="result-card client"><p>Verdict</p><h3>{verdict.decisionLabel}</h3><p><strong>Outcome:</strong> {verdict.outcome}</p><p><strong>Next step:</strong> {verdict.recommendedNextStep}</p></article><article className="result-card confidence"><p>Confidence</p><strong>{verdict.confidenceScore}%</strong></article></div>
      <section className="panel"><div className="heading-row"><div><p className="eyebrow">Payment split</p><h2>Suggested settlement</h2></div></div><div className="result-grid"><article className="result-card"><h3>Client share</h3><strong>{verdict.paymentSplit.client}%</strong><p>Client retains this portion based on evidence weight.</p></article><article className="result-card"><h3>Freelancer share</h3><strong>{verdict.paymentSplit.freelancer}%</strong><p>Freelancer is entitled to this portion of the disputed amount.</p></article></div></section>
      <MaterialFindings verdict={verdict} />
      <div className="panel"><div className="reasoning"><h3>Rationale</h3><ul>{verdict.explanation.map((item) => <li key={item}>{item}</li>)}</ul></div></div>
      <Link href={`/dispute/${encodeURIComponent(caseRecord.id)}`}><button className="secondary">Back to case details</button></Link>
    </section>
  )
}

export default function RulingPage() {
  return (
    <Suspense fallback={<section className="panel"><div className="notice"><h3>Loading ruling…</h3><p>Reading the Studionet contract.</p></div></section>}>
      <RulingContent />
    </Suspense>
  )
}
