'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DISPUTE_DRAFT_KEY, DisputeDraft, EvidenceItem, EvidenceRole } from '../../lib/cases'
import { GenLayerExecutionError, formatTransactionError, submitDispute } from '../../lib/genlayer'

const evidenceTypes = [
  { value: 'milestone', label: 'Milestone' },
  { value: 'chat', label: 'Chat' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'screenshot_link', label: 'Screenshot' },
  { value: 'delivery_note', label: 'Delivery Note' },
]

type PendingEvidence = Omit<EvidenceItem, 'id'>

export default function SubmitEvidencePage() {
  const [type, setType] = useState('')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [role, setRole] = useState<EvidenceRole>('client')
  const [importance, setImportance] = useState('')
  const [url, setUrl] = useState('')
  const [evidence, setEvidence] = useState<PendingEvidence[]>([])
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const [errors, setErrors] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [failedTransaction, setFailedTransaction] = useState<{
    hash: string
    receiptStatus: string
    executionError: string
  } | null>(null)
  const router = useRouter()

  const handleAddEvidence = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors: string[] = []
    if (!type) nextErrors.push('Evidence type is required.')
    if (!title.trim()) nextErrors.push('Evidence title is required.')
    if (!summary.trim()) nextErrors.push('Evidence summary is required.')
    if (!importance) nextErrors.push('Evidence importance is required.')
    if (!sessionStorage.getItem(DISPUTE_DRAFT_KEY)) {
      nextErrors.push('Start the dispute from the Create Dispute page before submitting evidence.')
    }
    if (nextErrors.length > 0) {
      setErrors(nextErrors)
      setStatus('error')
      return
    }

    setEvidence((current) => [...current, {
      type,
      title: title.trim(),
      summary: summary.trim(),
      role,
      importance,
      timestamp: new Date().toISOString(),
      url: url.trim(),
    }])
    setType('')
    setTitle('')
    setSummary('')
    setImportance('')
    setUrl('')
    setErrors([])
    setStatus('idle')
    setMessage('Evidence added. Add another record or submit the dispute.')
  }

  const handleSubmitDispute = async () => {
    const savedDraft = sessionStorage.getItem(DISPUTE_DRAFT_KEY)
    if (!savedDraft) {
      setErrors(['Start the dispute from the Create Dispute page before submitting evidence.'])
      setStatus('error')
      return
    }
    if (evidence.length === 0) {
      setErrors(['Add at least one evidence record before submitting the dispute.'])
      setStatus('error')
      return
    }

    setErrors([])
    setFailedTransaction(null)
    setStatus('pending')
    setMessage('Waiting for wallet approval and Bradbury consensus…')
    try {
      const draft = JSON.parse(savedDraft) as DisputeDraft
      const result = await submitDispute(draft, evidence)
      sessionStorage.removeItem(DISPUTE_DRAFT_KEY)
      setStatus('success')
      setMessage(`Dispute confirmed on Bradbury. Transaction: ${result.hash}`)
      window.setTimeout(() => router.push(`/dispute/${encodeURIComponent(result.caseId)}`), 1500)
    } catch (err) {
      setStatus('error')
      setErrors([formatTransactionError(err)])
      setFailedTransaction(err instanceof GenLayerExecutionError ? {
        hash: err.transactionHash,
        receiptStatus: err.receiptStatus,
        executionError: err.executionError,
      } : null)
      setMessage('')
    }
  }

  return (
    <section className="panel soft-panel">
      <div className="heading-row"><div><p className="eyebrow">Submit evidence</p><h2>Add supporting proof</h2></div></div>
      <form className="form-grid" onSubmit={handleAddEvidence} noValidate>
        <label>Evidence type<select value={type} onChange={(event) => setType(event.target.value)}><option value="" disabled>Select evidence type</option>{evidenceTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label>Evidence title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Name this piece of evidence" aria-required="true" /></label>
        <label>Role<select value={role} onChange={(event) => setRole(event.target.value as EvidenceRole)}><option value="client">Client</option><option value="freelancer">Freelancer</option></select></label>
        <label>Importance<select value={importance} onChange={(event) => setImportance(event.target.value)}><option value="" disabled>Select importance</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
        <label className="full-width">Evidence summary<textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Explain what this evidence demonstrates" aria-required="true" /></label>
        <label className="full-width">Reference URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Optional link to the evidence" /></label>
        <div className="full-width"><button type="submit" className="secondary" disabled={status === 'pending'}>Add evidence</button></div>
      </form>

      {evidence.length > 0 && <div className="evidence-list">
        {evidence.map((item, index) => <article key={`${item.role}-${index}`} className="evidence-item">
          <div><span>{item.type}</span><h4>{item.title}</h4><p>{item.summary}</p></div>
          <span className={`badge ${item.role === 'client' ? 'document' : 'evidence'}`}>{item.role === 'client' ? 'Client' : 'Freelancer'}</span>
        </article>)}
      </div>}

      <div><button type="button" className="primary" disabled={status === 'pending' || evidence.length === 0} onClick={handleSubmitDispute}>{status === 'pending' ? 'Submitting to Bradbury…' : 'Submit dispute'}</button></div>
      {status === 'idle' && message && <div className="notice"><p>{message}</p></div>}
      {status === 'pending' && <div className="notice"><h3>Transaction in progress</h3><p>{message}</p></div>}
      {status === 'error' && <div className="notice error-text">
        <h3>Submission failed</h3>
        <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
        {failedTransaction && <>
          <p><strong>Transaction hash:</strong> {failedTransaction.hash}</p>
          <p><strong>Receipt status:</strong> {failedTransaction.receiptStatus}</p>
          <p><strong>GenLayer execution error:</strong> {failedTransaction.executionError}</p>
        </>}
      </div>}
      {status === 'success' && <div className="notice"><h3>Dispute submitted</h3><p>{message}</p></div>}
    </section>
  )
}
