'use client'

import { use } from 'react'
import Link from 'next/link'
import { AgreementDetails, EvidenceDetails, MaterialFindings } from '../../components/DisputeRecords'
import { useLiveDispute } from '../../lib/use-live-state'
import PendingTransactions from '../../components/PendingTransactions'

function short(address: string) {
  return address ? `${address.slice(0, 8)}...${address.slice(-6)}` : 'Not recorded'
}

export default function DisputeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const live = useLiveDispute(decodeURIComponent(id))
  const { loading, caseData, error } = live

  if (loading) {
    return <section className="panel"><div className="notice"><h3>Loading case details...</h3><p>Reading the latest dispute from Studionet.</p></div></section>
  }
  if (!caseData) {
    return <section className="panel"><div className="notice error-text"><h3>Case not found</h3><p>{error || 'Checking Studionet automatically.'}</p><Link href="/dashboard"><button className="secondary">Back to dashboard</button></Link></div></section>
  }

  const verdict = caseData.verdict
  const walletsSeparated = Boolean(
    caseData.clientWallet &&
    caseData.freelancerWallet &&
    caseData.clientWallet.toLowerCase() !== caseData.freelancerWallet.toLowerCase()
  )

  return (
    <section className="panel">
      <PendingTransactions caseId={caseData.id} refreshToken="idle" onRecovered={() => live.refresh()} />
      <div className="heading-row">
        <div><p className="eyebrow">Case details · GenLayer Studionet</p><h2>{caseData.title}</h2></div>
        <div><span className="status-pill">{caseData.status}</span></div>
      </div>

      <div className="detail-grid">
        <div className="detail-card">
          <h3>Case summary</h3>
          <p>{caseData.summary}</p>
          <p><strong>Category:</strong> {caseData.category}</p>
          <p><strong>Amount:</strong> {caseData.amount}</p>
        </div>
        <div className="detail-card">
          <h3>Bound parties</h3>
          <p><strong>Client:</strong> {caseData.client}</p>
          <p><strong>Client Wallet:</strong> {caseData.clientWallet} ({short(caseData.clientWallet)})</p>
          <p><strong>Freelancer:</strong> {caseData.freelancer}</p>
          <p><strong>Freelancer Wallet:</strong> {caseData.freelancerWallet} ({short(caseData.freelancerWallet)})</p>
          <p><strong>{walletsSeparated ? '✓ Separate party wallets verified' : 'Wallet separation unavailable'}</strong></p>
        </div>
      </div>

      <AgreementDetails record={caseData} />
      {caseData.status !== 'evaluated' && <div className="notice"><p>No final verdict yet.</p><Link href={`/dispute/submit?case=${encodeURIComponent(caseData.id)}`}>Accept agreement, submit evidence or freeze and evaluate</Link></div>}

      {caseData.status === 'evaluated' && <div className="panel soft-panel">
        <div className="heading-row">
          <div><p className="eyebrow">Ruling</p><h2>Verdict and payment split</h2></div>
          <Link href={`/ruling?case=${encodeURIComponent(caseData.id)}`}><button className="secondary">View ruling page</button></Link>
        </div>
        <div className="result-grid">
          <article className="result-card client"><p>Verdict</p><h3>{verdict.decisionLabel}</h3><p><strong>Outcome:</strong> {verdict.outcome}</p><p><strong>Next step:</strong> {verdict.recommendedNextStep}</p></article>
          <article className="result-card confidence"><p>Confidence</p><strong>{verdict.confidenceScore}%</strong></article><article className="result-card"><p>Payment split</p><strong>{verdict.paymentSplit.client}% Client / {verdict.paymentSplit.freelancer}% Freelancer</strong></article>
        </div>
        <MaterialFindings verdict={verdict} />
        <div className="reasoning">
          <h3>Validator reasoning</h3>
          <p>Consensus is based on validator-fetched evidence whose response bytes were SHA-256 verified before evaluation.</p>
          <ul>{verdict.explanation.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>}

      <div className="panel">
        <div className="heading-row">
          <div><p className="eyebrow">Evidence</p><h2>Wallet-authenticated, validator-fetched evidence</h2></div>
        </div>
        <div className="evidence-list">
          {caseData.evidence.map((item) => (
            <article key={item.id} className="evidence-item">
              <div>
                <span>{item.type}</span>
                <h4>{item.title}</h4>
                <p>{item.summary}</p>
                <EvidenceDetails item={item} />
              </div>
              <span className={`badge ${item.role === 'client' ? 'document' : 'evidence'}`}>
                {item.role === 'client' ? 'Client' : 'Freelancer'}
              </span>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
