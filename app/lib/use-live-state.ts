'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DisputeCase } from './cases'
import { CONTRACT_ADDRESS, getDispute } from './genlayer'
import { getSelectedWalletProvider, getWalletAddress } from './wallet'
import { boundedRead } from './reconciliation'
import { watchLiveState } from './live-refresh'
import { pendingTransactions } from './pending-writes'
import { subscribeState } from './state-events'

export function useLiveResource<T>(key: string, load: () => Promise<T>, initial: T, invalidate?: () => void) {
  const [snapshot, setSnapshot] = useState({ key, data: initial, loading: true, error: '' })
  const sequence = useRef(0)
  const currentKey = useRef(key)
  currentKey.current = key
  const apply = useCallback((data: T) => {
    if (currentKey.current !== key) return
    sequence.current++
    setSnapshot({ key, data, loading: false, error: '' })
  }, [key])
  const refresh = useCallback(async () => {
    const request = ++sequence.current
    try {
      const data = await boundedRead(load)
      if (sequence.current === request && currentKey.current === key) setSnapshot({ key, data, loading: false, error: '' })
    } catch (error) {
      if (sequence.current === request && currentKey.current === key) setSnapshot(previous => ({
        key, data: previous.key === key ? previous.data : initial, loading: false,
        error: error instanceof Error ? error.message : 'Unable to read Studionet. Retrying automatically.',
      }))
    }
  }, [key, load, initial])
  useEffect(() => {
    const stop = watchLiveState(refresh, { window, document, getProvider: getSelectedWalletProvider,
      onWalletInvalidated: () => { sequence.current++; invalidate?.() } })
    return () => { sequence.current++; stop() }
  }, [refresh, invalidate])
  return { ...(snapshot.key === key ? snapshot : { key, data: initial, loading: true, error: '' }), refresh, apply }
}

export function useLiveDispute(caseId: string) {
  const [walletAddress, setWalletAddress] = useState('')
  const latestAddress = useRef('')
  latestAddress.current = walletAddress
  const invalidate = useCallback(() => { latestAddress.current = ''; setWalletAddress('') }, [])
  const load = useCallback(async () => {
    const [record, address] = await Promise.all([
      caseId ? getDispute(caseId) : Promise.resolve(null), getWalletAddress().catch(() => ''),
    ])
    return { record, address }
  }, [caseId])
  const initial = useRef({ record: null as DisputeCase | null, address: '' }).current
  const resource = useLiveResource(caseId, load, initial, invalidate)
  useEffect(() => { setWalletAddress(resource.data.address) }, [resource.data])
  useEffect(() => subscribeState(event => {
    if (event.type === 'confirmed' && event.caseId === caseId && event.record) {
      resource.apply({ record: event.record, address: latestAddress.current })
    }
  }), [caseId, resource.apply])
  return { caseData: resource.data.record, walletAddress, loading: resource.loading, error: resource.error,
    refresh: resource.refresh, apply: (record: DisputeCase) => resource.apply({ record, address: latestAddress.current }) }
}

export function usePendingWrites(caseId?: string, method?: string) {
  const [transactions, setTransactions] = useState<ReturnType<typeof pendingTransactions>>([])
  useEffect(() => {
    const update = () => setTransactions(pendingTransactions().filter(tx => tx.contract === CONTRACT_ADDRESS
      && (!caseId || tx.caseId === caseId) && (!method || tx.method === method)))
    update()
    return subscribeState(update)
  }, [caseId, method])
  return transactions
}
