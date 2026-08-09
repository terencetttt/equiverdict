'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { DisputeCase } from '../lib/cases'
import { listDisputes } from '../lib/genlayer'

export default function DashboardPage() {
  const [cases, setCases] = useState<DisputeCase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    listDisputes()
      .then(setCases)
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load disputes.'))
      .finally(() => setLoading(false))
  }, [])

  const resolved = cases.filter((item) => item.status === 'evaluated')
  const averageConfidence = resolved.length
    ? Math.round(resolved.reduce((total, item) => total + item.verdict.confidenceScore, 0) / resolved.length)
    : 0

  return (
    <section className="panel">
      <div className="heading-row">
        <div><p className="eyebrow">Dashboard</p><h2>Case portfolio</h2></div>
        <Link href="/dispute/new"><button className="primary">Create dispute</button></Link>
      </div>
      <div className="summary-row">
        <div className="summary-card"><p>Cases in progress</p><strong>{cases.length - resolved.length}</strong></div>
        <div className="summary-card"><p>Resolved fairly</p><strong>{resolved.length}</strong></div>
        <div className="summary-card"><p>Average confidence</p><strong>{averageConfidence}%</strong></div>
      </div>
      {loading ? (
        <div className="notice"><h3>Loading Bradbury disputes…</h3><p>Reading the latest contract state.</p></div>
      ) : error ? (
        <div className="notice error-text"><h3>Unable to load disputes</h3><p>{error}</p></div>
      ) : cases.length === 0 ? (
        <div className="notice"><h3>No disputes found</h3><p>Start by creating your first case with key issue details and evidence entries.</p></div>
      ) : (
        <div className="case-table">
          {cases.map((caseItem) => (
            <article key={caseItem.id} className="case-entry">
              <div><h3>{caseItem.title}</h3><p>{caseItem.summary}</p></div>
              <div>
                <span className={`pill ${caseItem.badge}`}>{caseItem.status}</span>
                <Link href={`/dispute/${encodeURIComponent(caseItem.id)}`}><button className="secondary">View case</button></Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
