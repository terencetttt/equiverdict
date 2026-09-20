'use client'

import { useEffect, useRef, useState } from 'react'
import type { DisputeCase } from '../lib/cases'
import { formatTransactionError, recoverPendingTransaction } from '../lib/genlayer'
import { usePendingWrites } from '../lib/use-live-state'
import { subscribeState } from '../lib/state-events'

export default function PendingTransactions({ caseId, method, refreshToken, onRecovered }: {
  caseId?: string
  method?: string
  refreshToken: string
  onRecovered: (caseId: string, method: string, record?: DisputeCase) => void | Promise<void>
}) {
  const transactions = usePendingWrites(caseId, method)
  const callback = useRef(onRecovered)
  callback.current = onRecovered
  const [error, setError] = useState('')
  useEffect(() => subscribeState(event => {
    if (event.type !== 'confirmed' || !event.caseId || !event.method
      || (caseId && caseId !== event.caseId) || (method && method !== event.method)) return
    setError('')
    void Promise.resolve(callback.current(event.caseId, event.method, event.record)).catch(failure => setError(formatTransactionError(failure)))
  }), [caseId, method])
  useEffect(() => {
    for (const tx of transactions) if (!tx.timedOut) {
      void recoverPendingTransaction(tx).catch(failure => setError(formatTransactionError(failure)))
    }
  }, [transactions])
  if (!transactions.length) return null
  return <div className="notice" role="status">
    <h3>{transactions.some(tx => !tx.timedOut) ? 'Confirming on Studionet...' : 'Confirmation is taking longer than expected'}</h3>
    <p>Your submitted transaction is saved. No additional wallet signature is needed.</p>
    {transactions.map(tx => <div key={tx.hash}>
      <p style={{ overflowWrap: 'anywhere' }}>{tx.hash}</p>
      {tx.timedOut && <button type="button" className="secondary" disabled={refreshToken === 'pending'} onClick={() => {
        setError('')
        void recoverPendingTransaction(tx).catch(failure => setError(formatTransactionError(failure)))
      }}>Check status</button>}
    </div>)}
    {error && transactions.every(tx => tx.timedOut) && <p>{error}</p>}
  </div>
}
