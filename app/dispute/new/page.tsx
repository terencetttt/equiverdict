'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DISPUTE_DRAFT_KEY, DisputeDraft } from '../../lib/cases'

export default function NewDisputePage() {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [summary, setSummary] = useState('')
  const [clientName, setClientName] = useState('')
  const [freelancerName, setFreelancerName] = useState('')
  const [amount, setAmount] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const router = useRouter()

  useEffect(() => {
    sessionStorage.removeItem(DISPUTE_DRAFT_KEY)
  }, [])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors: string[] = []

    if (!title.trim()) nextErrors.push('Case title is required.')
    if (!category) nextErrors.push('Case category is required.')
    if (!summary.trim()) nextErrors.push('Case summary is required.')
    if (!clientName.trim()) nextErrors.push('Client name is required.')
    if (!freelancerName.trim()) nextErrors.push('Freelancer name is required.')
    if (!amount.trim() || Number(amount) <= 0) nextErrors.push('Disputed amount must be greater than zero.')

    if (nextErrors.length > 0) {
      setErrors(nextErrors)
      setStatus('error')
      return
    }

    setErrors([])
    setStatus('pending')
    setMessage('Submitting dispute…')

    const draft: DisputeDraft = {
      caseId: `case-${Date.now()}`,
      title: title.trim(),
      category,
      summary: summary.trim(),
      clientName: clientName.trim(),
      freelancerName: freelancerName.trim(),
      amount: amount.trim(),
    }
    sessionStorage.setItem(DISPUTE_DRAFT_KEY, JSON.stringify(draft))

    setStatus('success')
    setMessage('Dispute details saved. Continue to evidence submission.')
    router.push('/dispute/submit')
  }

  return (
    <section className="panel soft-panel">
      <div className="heading-row">
        <div>
          <p className="eyebrow">Create dispute</p>
          <h2>Start a new case</h2>
        </div>
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
        <label className="full-width">
          Case summary
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Summarize the agreement and disputed issue" aria-required="true" />
        </label>
        <div className="full-width">
          <button type="submit" className="primary" disabled={status === 'pending'}>
            {status === 'pending' ? 'Saving…' : 'Continue to evidence'}
          </button>
        </div>
      </form>

      {status === 'error' && (
        <div className="notice error-text">
          <h3>There are issues to fix</h3>
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {status === 'success' && (
        <div className="notice">
          <h3>Success</h3>
          <p>{message}</p>
        </div>
      )}
    </section>
  )
}
