'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DISPUTE_DRAFT_KEY,
  DisputeCase,
  DisputeDraft,
  EvidenceRole,
  EvidenceSubmission,
} from '../../lib/cases'
import {
  GenLayerExecutionError,
  evaluateDispute,
  formatTransactionError,
  getConnectedWalletAddress,
  getDispute,
  submitEvidence,
} from '../../lib/genlayer'

const evidenceTypes = [
  { value: 'milestone', label: 'Milestone' },
  { value: 'chat', label: 'Chat / message export' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'delivery_note', label: 'Delivery note' },
  { value: 'other_text', label: 'Other text / JSON evidence' },
]

function short(address: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '—'
}

export default function SubmitEvidencePage() {
  const [draft, setDraft] = useState<DisputeDraft | null>(null)
  const [caseData, setCaseData] = useState<DisputeCase | null>(null)
  const [walletAddress, setWalletAddress] = useState('')
  const [role, setRole] = useState<EvidenceRole | null>(null)
  const [type, setType] = useState('')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [importance, setImportance] = useState('')
  const [url, setUrl] = useState('')
  const [sha256, setSha256] = useState('')
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const [errors, setErrors] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [failedTransaction, setFailedTransaction] = useState<{
    hash: string
    receiptStatus: string
    executionError: string
  } | null>(null)
  const router = useRouter()

  const refreshRole = useCallback(async (caseId: string) => {
    const [chainCase, connected] = await Promise.all([
      getDispute(caseId),
      getConnectedWalletAddress(),
    ])
    setCaseData(chainCase)
    setWalletAddress(connected)

    const lower = connected.toLowerCase()
    if (lower === chainCase.clientWallet.toLowerCase()) setRole('client')
    else if (lower === chainCase.freelancerWallet.toLowerCase()) setRole('freelancer')
    else setRole(null)
  }, [])

  useEffect(() => {
    const saved = sessionStorage.getItem(DISPUTE_DRAFT_KEY)
    if (!saved) {
      setStatus('error')
      setErrors(['Create a dispute on Bradbury before submitting evidence.'])
      return
    }
    const parsed = JSON.parse(saved) as DisputeDraft
    setDraft(parsed)
    refreshRole(parsed.caseId).catch((error) => {
      setStatus('error')
      setErrors([formatTransactionError(error)])
    })
  }, [refreshRole])

  const handleSubmitEvidence = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft) return

    const nextErrors: string[] = []
    if (!role) nextErrors.push('Only a party bound to this dispute can submit evidence.')
    if (!type) nextErrors.push('Evidence type is required.')
    if (!title.trim()) nextErrors.push('Evidence title is required.')
    if (!summary.trim()) nextErrors.push('Evidence description is required.')
    if (!importance) nextErrors.push('Evidence importance is required.')
    if (!url.trim().startsWith('https://')) nextErrors.push('Evidence URL must use HTTPS.')
    if (!/^[0-9a-fA-F]{64}$/.test(sha256.trim())) {
      nextErrors.push('Evidence SHA-256 must be exactly 64 hexadecimal characters.')
    }

    if (nextErrors.length) {
      setStatus('error')
      setErrors(nextErrors)
      return
    }

    const evidence: EvidenceSubmission = {
      type,
      title: title.trim(),
      summary: summary.trim(),
      importance,
      timestamp: new Date().toISOString(),
      url: url.trim(),
      evidenceSha256: sha256.trim().toLowerCase(),
    }

    setErrors([])
    setFailedTransaction(null)
    setStatus('pending')
    setMessage(`Submitting as ${role === 'client' ? 'Client' : 'Freelancer'} from ${short(walletAddress)}...`)

    try {
      const result = await submitEvidence(draft.caseId, evidence)
      await refreshRole(draft.caseId)
      setType('')
      setTitle('')
      setSummary('')
      setImportance('')
      setUrl('')
      setSha256('')
      setStatus('success')
      setMessage(`Evidence authenticated by wallet and stored on Bradbury. Transaction: ${result.hash}`)
    } catch (error) {
      setStatus('error')
      setErrors([formatTransactionError(error)])
      setFailedTransaction(error instanceof GenLayerExecutionError ? {
        hash: error.transactionHash,
        receiptStatus: error.receiptStatus,
        executionError: error.executionError,
      } : null)
      setMessage('')
    }
  }

  const handleEvaluate = async () => {
    if (!draft || !caseData) return
    const clientCount = caseData.evidence.filter((item) => item.role === 'client').length
    const freelancerCount = caseData.evidence.filter((item) => item.role === 'freelancer').length

    if (!role) {
      setStatus('error')
      setErrors(['Only a party bound to this dispute can request evaluation.'])
      return
    }
    if (!clientCount || !freelancerCount) {
      setStatus('error')
      setErrors(['At least one wallet-authenticated evidence item from BOTH parties is required before evaluation.'])
      return
    }

    setErrors([])
    setFailedTransaction(null)
    setStatus('pending')
    setMessage('GenLayer validators are fetching and SHA-256 verifying both parties’ evidence before consensus...')

    try {
      const result = await evaluateDispute(draft.caseId)
      setStatus('success')
      setMessage(`Consensus completed on Bradbury. Transaction: ${result.hash}`)
      sessionStorage.removeItem(DISPUTE_DRAFT_KEY)
      window.setTimeout(() => router.push(`/dispute/${encodeURIComponent(result.caseId)}`), 700)
    } catch (error) {
      setStatus('error')
      setErrors([formatTransactionError(error)])
      setFailedTransaction(error instanceof GenLayerExecutionError ? {
        hash: error.transactionHash,
        receiptStatus: error.receiptStatus,
        executionError: error.executionError,
      } : null)
      setMessage('')
    }
  }

  const clientCount = caseData?.evidence.filter((item) => item.role === 'client').length ?? 0
  const freelancerCount = caseData?.evidence.filter((item) => item.role === 'freelancer').length ?? 0

  return (
    <section className="panel soft-panel">
      <div className="heading-row">
        <div>
          <p className="eyebrow">Submit evidence</p>
          <h2>Wallet-authenticated supporting proof</h2>
          <p>Role is derived from the connected wallet. There is no user-selectable role.</p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={!draft || status === 'pending'}
          onClick={() => draft && refreshRole(draft.caseId)}
        >
          Refresh wallet role
        </button>
      </div>

      {caseData && (
        <div className="detail-grid">
          <div className="detail-card">
            <h3>Bound party wallets</h3>
            <p><strong>Client Wallet:</strong> {caseData.clientWallet}</p>
            <p><strong>Freelancer Wallet:</strong> {caseData.freelancerWallet}</p>
            <p><strong>Verification:</strong> Separate party wallets verified</p>
          </div>
          <div className="detail-card">
            <h3>Connected wallet</h3>
            <p>{walletAddress || 'Not connected'}</p>
            <p><strong>{role ? `Submitting as ${role === 'client' ? 'Client' : 'Freelancer'}` : 'Not a bound party'}</strong></p>
            <p>Client evidence: {clientCount} · Freelancer evidence: {freelancerCount}</p>
          </div>
        </div>
      )}

      <form className="form-grid" onSubmit={handleSubmitEvidence} noValidate>
        <label>
          Evidence type
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="" disabled>Select evidence type</option>
            {evidenceTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          Evidence title
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Name this evidence" aria-required="true" />
        </label>
        <label>
          Importance
          <select value={importance} onChange={(event) => setImportance(event.target.value)}>
            <option value="" disabled>Select importance</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="full-width">
          Evidence description / context
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Context only; validators rely on fetched evidence contents" aria-required="true" />
        </label>
        <label className="full-width">
          Public HTTPS evidence URL
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://raw.githubusercontent.com/.../evidence.txt" aria-required="true" />
        </label>
        <label className="full-width">
          SHA-256 of exact evidence bytes
          <input value={sha256} onChange={(event) => setSha256(event.target.value)} placeholder="64 hexadecimal characters" aria-required="true" />
        </label>
        <div className="full-width">
          <button type="submit" className="secondary" disabled={status === 'pending' || !role}>
            {status === 'pending' ? 'Submitting...' : role ? `Submit as ${role === 'client' ? 'Client' : 'Freelancer'}` : 'Only a bound party can submit'}
          </button>
        </div>
      </form>

      {caseData && caseData.evidence.length > 0 && (
        <div className="evidence-list">
          {caseData.evidence.map((item) => (
            <article key={item.id} className="evidence-item">
              <div>
                <span>{item.type}</span>
                <h4>{item.title}</h4>
                <p>{item.summary}</p>
                <p><strong>Submitter:</strong> {item.submittingWallet}</p>
                <p><strong>SHA-256:</strong> {item.evidenceSha256}</p>
                <p><a href={item.url} target="_blank" rel="noreferrer">Open validator-fetched evidence</a></p>
              </div>
              <span className={`badge ${item.role === 'client' ? 'document' : 'evidence'}`}>
                {item.role === 'client' ? 'Client' : 'Freelancer'}
              </span>
            </article>
          ))}
        </div>
      )}

      <div>
        <button
          type="button"
          className="primary"
          disabled={status === 'pending' || !role || clientCount === 0 || freelancerCount === 0}
          onClick={handleEvaluate}
        >
          {status === 'pending' ? 'Waiting for Bradbury...' : 'Evaluate verified evidence'}
        </button>
      </div>

      {(status === 'idle' || status === 'success' || status === 'pending') && message && (
        <div className="notice"><p>{message}</p></div>
      )}
      {status === 'error' && (
        <div className="notice error-text">
          <h3>Action failed</h3>
          <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
          {failedTransaction && <>
            <p><strong>Transaction hash:</strong> {failedTransaction.hash}</p>
            <p><strong>Receipt status:</strong> {failedTransaction.receiptStatus}</p>
            <p><strong>GenLayer execution error:</strong> {failedTransaction.executionError}</p>
          </>}
        </div>
      )}
    </section>
  )
}
