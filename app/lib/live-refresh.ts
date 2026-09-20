import type { WalletProvider } from './wallet'
import { subscribeState } from './state-events'

// One subscription implementation for all pages; cleanup also invalidates queued work.
export function watchLiveState(refresh: () => Promise<unknown>, options: {
  getProvider: () => WalletProvider | null
  onWalletInvalidated?: () => void
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>
  document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
  intervalMs?: number
}) {
  let active = true
  let running = false
  let queued = false
  let provider: WalletProvider | null = null
  const run = async () => {
    if (!active) return
    if (running) { queued = true; return }
    running = true
    do {
      queued = false
      try { await refresh() } catch { /* The consumer owns its error state. */ }
    } while (active && queued)
    running = false
  }
  const trigger = () => { void run() }
  const walletChanged = () => { options.onWalletInvalidated?.(); trigger() }
  const bind = () => {
    const next = options.getProvider()
    if (next === provider) return
    provider?.removeListener?.('accountsChanged', walletChanged)
    provider?.removeListener?.('chainChanged', walletChanged)
    provider = next
    provider?.on?.('accountsChanged', walletChanged)
    provider?.on?.('chainChanged', walletChanged)
  }
  const visible = () => { if (options.document.visibilityState === 'visible') trigger() }
  const unsubscribe = subscribeState(event => {
    if (event.type === 'wallet') { bind(); walletChanged() }
    else trigger()
  })
  options.window.addEventListener('focus', trigger)
  options.document.addEventListener('visibilitychange', visible)
  const timer = setInterval(() => { bind(); visible() }, options.intervalMs ?? 4000)
  bind()
  trigger()
  return () => {
    active = false
    clearInterval(timer)
    unsubscribe()
    options.window.removeEventListener('focus', trigger)
    options.document.removeEventListener('visibilitychange', visible)
    provider?.removeListener?.('accountsChanged', walletChanged)
    provider?.removeListener?.('chainChanged', walletChanged)
  }
}
