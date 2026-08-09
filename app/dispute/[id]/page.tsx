'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { DisputeCase } from '../../lib/cases'
import { getDispute } from '../../lib/genlayer'

export default function DisputeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [loading, setLoading] = useState(true)
  const [caseData, setCaseData] = useState<DisputeCase | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getDispute(decodeURIComponent(id))
      .then(setCaseData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load this dispute.'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <section className="panel"><div className="notice"><h3>Loading case details…</h3><p>Reading the latest dispute from Bradbury.</p></div></section>
  if (!caseData) return <section className="panel"><div className="notice error-text"><h3>Case not found</h3><p>{error || 'Check the case ID and try again.'}</p><Link href="/dashboard"><button className="secondary">Back to dashboard</button></Link></div></section>

  const verdict = caseData.verdict
  return (
    <section className="panel">
      <div className="heading-row"><div><p className="eyebrow">Case details</p><h2>{caseData.title}</h2></div><div><span className="status-pill">{caseData.status}</span></div></div>
      <div className="detail-grid">
        <div className="detail-card"><h3>Case summary</h3><p>{caseData.summary}</p><p><strong>Category:</strong> {caseData.category}</p><p><strong>Amount:</strong> {caseData.amount}</p></div>
        <div className="detail-card"><h3>Participants</h3><p><strong>Client:</strong> {caseData.client}</p><p><strong>Freelancer:</strong> {caseData.freelancer}</p><p><strong>Created:</strong> {caseData.createdAt || 'Recorded on-chain'}</p></div>
      </div>
      <div className="panel soft-panel">
        <div className="heading-row"><div><p className="eyebrow">Ruling</p><h2>Verdict and payment split</h2></div><Link href={`/ruling?case=${encodeURIComponent(caseData.id)}`}><button className="secondary">View ruling page</button></Link></div>
        <div className="result-grid"><article className="result-card client"><p>Verdict</p><h3>{verdict.decisionLabel}</h3><p>{verdict.recommendedNextStep}</p></article><article className="result-card confidence"><p>Confidence</p><strong>{verdict.confidenceScore}%</strong></article></div>
        <div className="reasoning"><h3>Reasoning</h3><ul>{verdict.explanation.map((item) => <li key={item}>{item}</li>)}</ul></div>
      </div>
      <div className="panel">
        <div className="heading-row"><div><p className="eyebrow">Evidence</p><h2>Uploaded evidence</h2></div></div>
        <div className="evidence-list">{caseData.evidence.map((item) => <article key={item.id} className="evidence-item"><div><span>{item.type}</span><h4>{item.title}</h4><p>{item.summary}</p></div><span className={`badge ${item.role === 'client' ? 'document' : 'evidence'}`}>{item.role}</span></article>)}</div>
      </div>
    </section>
  )
}
