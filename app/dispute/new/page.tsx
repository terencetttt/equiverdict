'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getWalletAddress } from '../../lib/wallet'
import { useLiveResource, usePendingWrites } from '../../lib/use-live-state'
import PendingTransactions from '../../components/PendingTransactions'
import { DISPUTE_DRAFT_KEY, DisputeDraft } from '../../lib/cases'
import { createDispute, formatTransactionError, getConnectedWalletAddress } from '../../lib/genlayer'

import { AGREEMENT_VERSION, canonicalAgreement, agreementSha256 } from '../../lib/agreement'

export default function NewDisputePage() {
  const [caseId, setCaseId] = useState('')
  const [clientWallet, setClientWallet] = useState('')
  const [terms, setTerms] = useState('')
  const [agreementHash, setAgreementHash] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [summary, setSummary] = useState('')
  const [clientName, setClientName] = useState('')
  const [freelancerName, setFreelancerName] = useState('')
  const [freelancerWallet, setFreelancerWallet] = useState('')
  const [amount, setAmount] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const router = useRouter()
  const pending = usePendingWrites(undefined, 'create_dispute')
  const loadWallet = useCallback(() => getWalletAddress(), [])
  const invalidateWallet = useCallback(() => setClientWallet(''), [])
  const wallet = useLiveResource('create-wallet', loadWallet, '', invalidateWallet)
  useEffect(() => { setClientWallet(wallet.data) }, [wallet.data])

  useEffect(() => {
    setCaseId(`case-${crypto.randomUUID()}`)
  }, [])

  const draft: DisputeDraft = useMemo(() => ({
    caseId, title: title.trim(), category, summary: summary.trim(), terms: terms.trim(),
    clientName: clientName.trim(), freelancerName: freelancerName.trim(),
    freelancerWallet: freelancerWallet.trim(), amount: amount.trim(),
  }), [caseId, title, category, summary, terms, clientName, freelancerName, freelancerWallet, amount])
  const agreement = useMemo(() => canonicalAgreement(draft, clientWallet), [draft, clientWallet])
  useEffect(() => {
    let active = true
    setAgreementHash('')
    agreementSha256(agreement).then((hash) => { if (active) setAgreementHash(hash) }).catch(() => {
      if (active) setErrors(['Unable to hash the agreement. Use a secure HTTPS or localhost connection.'])
    })
    return () => { active = false }
  }, [agreement])

  const connectClient = async () => {
    try {
      setClientWallet(await getConnectedWalletAddress())
      setErrors([])
    } catch (error) {
      setStatus('error')
      setErrors([formatTransactionError(error)])
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors: string[] = []

    if (!clientWallet) nextErrors.push('Connect the client wallet and review the agreement.')
    if (!terms.trim()) nextErrors.push('Canonical agreement terms are required.')
    if (!agreementHash) nextErrors.push('Wait for the agreement hash before creating the case.')
    if (!title.trim()) nextErrors.push('Case title is required.')
    if (!category) nextErrors.push('Case category is required.')
    if (!summary.trim()) nextErrors.push('Case summary is required.')
    if (!clientName.trim()) nextErrors.push('Client name is required.')
    if (!freelancerName.trim()) nextErrors.push('Freelancer name is required.')
    if (!/^0x[0-9a-fA-F]{40}$/.test(freelancerWallet.trim())) {
      nextErrors.push('Enter a valid freelancer wallet address.')
    }
    if (!amount.trim() || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      nextErrors.push('Disputed amount must be greater than zero.')
    }

    if (nextErrors.length > 0) {
      setErrors(nextErrors)
      setStatus('error')
      return
    }

    setErrors([])
    setStatus('pending')
    setMessage('Confirming on Studionet...')

    try {
      const result = await createDispute(draft, clientWallet)
      sessionStorage.setItem(DISPUTE_DRAFT_KEY, JSON.stringify(draft))
      setStatus('success')
      setMessage(
        `Case created on Studionet. Client ${result.clientWallet} is bound separately from freelancer ${draft.freelancerWallet}.`,
      )
      router.push(`/dispute/${encodeURIComponent(result.caseId)}`)
    } catch (error) {
      setStatus('error')
      setErrors([formatTransactionError(error)])
      setMessage('')
    }
  }

  return (
    <section className="panel soft-panel">
      <PendingTransactions method="create_dispute" refreshToken={status} onRecovered={id => router.push(`/dispute/${encodeURIComponent(id)}`)} />
      <div className="heading-row">
        <div>
          <p className="eyebrow">Create dispute</p>
          <h2>Start a new case</h2>
          <p>The connected wallet becomes the Client wallet and cannot also be the Freelancer.</p>
        </div>
      </div>

      <div className="detail-card">
        <p><strong>Agreement version:</strong> {AGREEMENT_VERSION}</p>
        <p><strong>Client wallet:</strong> {clientWallet || 'Connect to bind the client wallet'}</p>
        <p><strong>Freelancer wallet:</strong> {freelancerWallet || 'Enter below'}</p>
        <p><strong>agreement_sha256:</strong> {agreementHash || 'Calculating...'}</p>
        <button type="button" className="secondary" onClick={connectClient} disabled={status === 'pending'}>Connect / refresh client wallet</button>
        <details><summary>Preview exact canonical agreement</summary><p>{agreement}</p></details>
        <p>Both parties must separately accept this exact agreement after creation. Creating a case does not accept it.</p>
      </div>

      <form className="form-grid" onSubmit={handleSubmit} noValidate>
        <label>
          Case title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Describe the main dispute" aria-required="true" />
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="" disabled>Select a category</option>
            <option>Missed deadline</option>
            <option>Scope mismatch</option>
            <option>Incomplete delivery</option>
          </select>
        </label>
        <label>
          Disputed amount
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter the disputed amount" aria-required="true" />
        </label>
        <label>
          Client name
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client name" aria-required="true" />
        </label>
        <label>
          Freelancer name
          <input value={freelancerName} onChange={(e) => setFreelancerName(e.target.value)} placeholder="Freelancer name" aria-required="true" />
        </label>
        <label>
          Freelancer wallet
          <input value={freelancerWallet} onChange={(e) => setFreelancerWallet(e.target.value)} placeholder="0x..." aria-required="true" />
        </label>
        <label className="full-width">
          Agreed terms, deliverables and payment conditions
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Enter the complete agreement both parties will accept" aria-required="true" />
        </label>
        <label className="full-width">
          Case summary
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Summarize the agreement and disputed issue" aria-required="true" />
        </label>
        <div className="full-width">
          <button type="submit" className="primary" disabled={status === 'pending' || pending.length > 0 || !clientWallet || !agreementHash}>
            {status === 'pending' || pending.length ? 'Confirming on Studionet...' : 'Create case on Studionet'}
          </button>
        </div>
      </form>

      {status === 'error' && pending.length === 0 && (
        <div className="notice error-text">
          <h3>There are issues to fix</h3>
          <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
        </div>
      )}

      {(status === 'pending' || status === 'success') && message && (
        <div className="notice"><p>{message}</p></div>
      )}
    </section>
  )
}
