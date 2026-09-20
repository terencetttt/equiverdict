import { publishState } from './state-events'
import { studionet } from 'genlayer-js/chains'

export type WalletProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>
  on?: (event: string, handler: (...args: unknown[]) => void) => void
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
  providers?: WalletProvider[]
}

export type DiscoveredWallet = {
  id: string
  name: string
  provider: WalletProvider
}

type Eip6963ProviderDetail = {
  info?: { uuid?: string; rdns?: string; name?: string }
  provider?: WalletProvider
}

export const STUDIONET_CHAIN_ID = `0x${studionet.id.toString(16)}`
export const NO_WALLET_MESSAGE = 'No compatible wallet detected. Install an EVM-compatible wallet to continue.'

let selectedProvider: WalletProvider | null = null

export function setSelectedWalletProvider(provider: WalletProvider | null) {
  if (selectedProvider === provider) return
  selectedProvider = provider
  publishState({ type: 'wallet' })
}

export function getSelectedWalletProvider() {
  return selectedProvider
}

export async function discoverWallets(waitMs = 250): Promise<DiscoveredWallet[]> {
  if (typeof window === 'undefined') return []

  const wallets: DiscoveredWallet[] = []
  const seen = new Set<WalletProvider>()
  const add = (provider: WalletProvider, name: string, id: string) => {
    if (seen.has(provider) || typeof provider.request !== 'function') return
    seen.add(provider)
    wallets.push({ provider, name, id })
  }

  const onAnnouncement = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail
    if (detail?.provider) {
      add(detail.provider, detail.info?.name || 'Browser Wallet', detail.info?.uuid || detail.info?.rdns || `wallet-${wallets.length}`)
    }
  }

  window.addEventListener('eip6963:announceProvider', onAnnouncement as EventListener)
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  await new Promise((resolve) => window.setTimeout(resolve, waitMs))
  window.removeEventListener('eip6963:announceProvider', onAnnouncement as EventListener)

  const ethereum = (window as unknown as { ethereum?: WalletProvider }).ethereum
  if (ethereum) {
    const injected = Array.isArray(ethereum.providers) ? ethereum.providers : [ethereum]
    injected.forEach((provider, index) => add(provider, injected.length > 1 ? `Browser Wallet ${index + 1}` : 'Browser Wallet', `injected-${index}`))
  }

  return wallets
}

function errorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const record = error as Record<string, unknown>
  if (typeof record.code === 'number') return record.code
  return errorCode(record.error) ?? errorCode(record.cause)
}

export async function ensureStudionetNetwork(provider: WalletProvider) {
  const currentChainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase()
  if (currentChainId === STUDIONET_CHAIN_ID) return currentChainId

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: STUDIONET_CHAIN_ID }],
    })
  } catch (error) {
    if (errorCode(error) !== 4902) throw error
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: STUDIONET_CHAIN_ID,
        chainName: studionet.name,
        rpcUrls: [...studionet.rpcUrls.default.http],
        nativeCurrency: studionet.nativeCurrency,
        blockExplorerUrls: studionet.blockExplorers?.default.url
          ? [studionet.blockExplorers.default.url]
          : [],
      }],
    })
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: STUDIONET_CHAIN_ID }],
    })
  }

  const switchedChainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase()
  if (switchedChainId !== STUDIONET_CHAIN_ID) {
    throw new Error(`Wallet is on chain ${switchedChainId}; GenLayer Studionet requires ${STUDIONET_CHAIN_ID}.`)
  }
  return switchedChainId
}

// Passive refresh must never open Rabby or request a network switch.
export async function getWalletAddress() {
  let provider = getSelectedWalletProvider()
  if (!provider) {
    const wallets = await discoverWallets()
    const preferred = wallets.find(wallet => /rabby/i.test(wallet.name)) ?? wallets[0]
    if (!preferred) return ''
    provider = getSelectedWalletProvider() ?? preferred.provider
    const accounts = await provider.request({ method: 'eth_accounts' })
    if (!Array.isArray(accounts) || !accounts.length) return ''
    setSelectedWalletProvider(provider)
  }
  const [accounts, chain] = await Promise.all([
    provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' }),
  ])
  return String(chain).toLowerCase() === STUDIONET_CHAIN_ID && Array.isArray(accounts) ? String(accounts[0] ?? '') : ''
}
