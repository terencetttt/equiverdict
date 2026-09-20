'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DISPUTE_DRAFT_KEY,
  EvidenceSubmission,
} from '../../lib/cases'
import {
  GenLayerExecutionError,
  acceptAgreement,
  freezeEvidence,
  evaluateDispute,
  formatTransactionError,
  getConnectedWalletAddress,
  submitEvidence,
} from '../../lib/genlayer'

import Link from 'next/link'
import PendingTransactions from '../../components/PendingTransactions'
import { AgreementDetails, EvidenceDetails } from '../../components/DisputeRecords'
import { disputeActions } from '../../lib/lifecycle'
import { useLiveDispute, usePendingWrites } from '../../lib/use-live-state'

const evidenceTypes = [
  { value: 'milestone', label: 'Milestone' },
  { value: 'chat', label: 'Chat / message export' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'delivery_note', label: 'Delivery note' },
  { value: 'other_text', label: 'Other text / JSON evidence' },
]

export default function SubmitEvidencePage() {
  const [caseId, setCaseId] = useState('')
  const [caseInput, setCaseInput] = useState('')
  const live = useLiveDispute(caseId)
  const { caseData, walletAddress } = live
  const pending = usePendingWrites(caseId || undefined)
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
  const reportError = useCallback((error: unknown) => {
    setStatus('error')
    setErrors([formatTransactionError(error)])
  }, [])

  useEffect(() => {
    try {
      const queryCase = new URLSearchParams(window.location.search).get('case')
      const saved = sessionStorage.getItem(DISPUTE_DRAFT_KEY)
      const savedCase = !queryCase && saved ? (JSON.parse(saved) as { caseId?: string }).caseId : ''
      const id = queryCase || savedCase || ''
      setCaseId(id)
      setCaseInput(id)
    } catch {
      reportError(new Error('Unable to restore the saved case. Enter the case ID below.'))
    }
  }, [reportError])

  const actions = disputeActions(caseData?.id === caseId ? caseData : null, walletAddress, status === 'pending' || pending.length > 0)
  const role = actions.role

  const openCase = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const id = caseInput.trim()
    if (!id) return
    setCaseId(id)
    setErrors([])
    setMessage('')
    setStatus('idle')
    window.history.replaceState(null, '', `/dispute/submit?case=${encodeURIComponent(id)}`)
  }

  const handleLifecycle = async (action: 'accept' | 'freeze') => {
    if (!caseData || (action === 'accept' ? !actions.canAccept : !actions.canFreeze)) return
    setStatus('pending')
    setErrors([])
    setFailedTransaction(null)
    setMessage('Confirming on Studionet...')
    try {
      const result = action === 'accept'
        ? await acceptAgreement(caseId, caseData.agreementSha256)
        : await freezeEvidence(caseId)
      live.apply(result.record)
      setStatus('success')
      setMessage(`${action === 'accept' ? 'Agreement accepted' : 'Evidence frozen'}. Transaction: ${result.hash}`)
    } catch (error) {
      reportError(error)
      setMessage('')
    }
  }

  const handleSubmitEvidence = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!caseData || !actions.canSubmit) return

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
      acceptedAgreementSha256: caseData.agreementSha256,
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
    setMessage('Confirming on Studionet...')

    try {
      const result = await submitEvidence(caseId, evidence)
      live.apply(result.record)
      setType('')
      setTitle('')
      setSummary('')
      setImportance('')
      setUrl('')
      setSha256('')
      setStatus('success')
      setMessage(`Evidence authenticated by wallet and stored on Studionet. Transaction: ${result.hash}`)
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
    if (!caseData || !actions.canEvaluate) return
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
    setMessage('Confirming on Studionet...')

    try {
      const result = await evaluateDispute(caseId)
      live.apply(result.record)
      setStatus('success')
      setMessage(`Consensus completed on Studionet. Transaction: ${result.hash}`)
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
      <PendingTransactions caseId={caseId || undefined} refreshToken={status} onRecovered={async (id, method, record) => {
        if (record) live.apply(record)
        else await live.refresh()
        setStatus('success')
        setErrors([])
        setFailedTransaction(null)
        setMessage('Transaction confirmed. Case state refreshed.')
        if (method === 'submit_evidence') {
          setType(''); setTitle(''); setSummary(''); setImportance(''); setUrl(''); setSha256('')
        }
        if (method === 'evaluate_dispute') {
          sessionStorage.removeItem(DISPUTE_DRAFT_KEY)
          router.push(`/dispute/${encodeURIComponent(id)}`)
        }
      }} />
      <div className="heading-row">
        <div>
          <p className="eyebrow">Submit evidence</p>
          <h2>Wallet-authenticated supporting proof</h2>
          <p>Role is derived from the connected wallet. There is no user-selectable role.</p>
        </div>
        {!walletAddress && <button type="button" className="secondary" onClick={async () => {
          try { await getConnectedWalletAddress(); await live.refresh() } catch (error) { reportError(error) }
        }}>Connect wallet</button>}
      </div>

      {live.loading && caseId && <p role="status">Reading current case state...</p>}
      {live.error && <p role="status">Unable to read current state. Retrying automatically.</p>}
      <form className="form-grid" onSubmit={openCase}>
        <label>Open an existing case<input value={caseInput} onChange={(event) => setCaseInput(event.target.value)} placeholder="Case ID shared by either party" /></label>
        <div><button className="secondary" type="submit" disabled={status === 'pending' || !caseInput.trim()}>Open case</button></div>
      </form>

      {caseData && <>
        <p><strong>Case ID:</strong> {caseData.id} | <Link href={`/dispute/submit?case=${encodeURIComponent(caseData.id)}`}>Share this case link with the other party</Link></p>
        <AgreementDetails record={caseData} />
        <button type="button" className="secondary" disabled={!actions.canAccept} onClick={() => handleLifecycle('accept')}>Accept this agreement as {role || 'a bound party'}</button>
        {!actions.mutuallyAccepted && <p>Both parties must accept before evidence can be submitted.</p>}
        {caseData.evidenceFrozen && <p>Evidence is permanently frozen. No more evidence can be submitted to this case.</p>}
      </>}

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
          <button type="submit" className="secondary" disabled={!actions.canSubmit}>
            {status === 'pending' || pending.length ? 'Confirming on Studionet...' : role ? `Submit as ${role === 'client' ? 'Client' : 'Freelancer'}` : 'Only a bound party can submit'}
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
                <EvidenceDetails item={item} />
              </div>
              <span className={`badge ${item.role === 'client' ? 'document' : 'evidence'}`}>
                {item.role === 'client' ? 'Client' : 'Freelancer'}
              </span>
            </article>
          ))}
        </div>
      )}

      <div>
        <p>Freeze only after both parties have finished submitting evidence. Freezing is permanent and requires at least one item from each party.</p>
        <button type="button" className="secondary" disabled={!actions.canFreeze} onClick={() => handleLifecycle('freeze')}>Freeze evidence permanently</button>
        <button
          type="button"
          className="primary"
          disabled={!actions.canEvaluate}
          onClick={handleEvaluate}
        >
          {status === 'pending' || pending.length ? 'Confirming on Studionet...' : 'Evaluate verified evidence'}
        </button>
      </div>

      {caseData?.status === 'evaluated' && <Link href={`/dispute/${encodeURIComponent(caseData.id)}`}>View final verdict, material findings and explanation</Link>}

      {(status === 'idle' || status === 'success' || status === 'pending') && message && (
        <div className="notice"><p>{message}</p></div>
      )}
      {status === 'error' && pending.length === 0 && (
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
