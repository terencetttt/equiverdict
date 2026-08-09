import { testnetBradbury } from 'genlayer-js/chains'

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

export const BRADBURY_CHAIN_ID = `0x${testnetBradbury.id.toString(16)}`
export const NO_WALLET_MESSAGE = 'No compatible wallet detected. Install an EVM-compatible wallet to continue.'

let selectedProvider: WalletProvider | null = null

export function setSelectedWalletProvider(provider: WalletProvider | null) {
  selectedProvider = provider
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

export async function ensureBradburyNetwork(provider: WalletProvider) {
  const currentChainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase()
  if (currentChainId === BRADBURY_CHAIN_ID) return currentChainId

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BRADBURY_CHAIN_ID }],
    })
  } catch (error) {
    if (errorCode(error) !== 4902) throw error
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: BRADBURY_CHAIN_ID,
        chainName: testnetBradbury.name,
        rpcUrls: [...testnetBradbury.rpcUrls.default.http],
        nativeCurrency: testnetBradbury.nativeCurrency,
        blockExplorerUrls: testnetBradbury.blockExplorers?.default.url
          ? [testnetBradbury.blockExplorers.default.url]
          : [],
      }],
    })
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BRADBURY_CHAIN_ID }],
    })
  }

  const switchedChainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase()
  if (switchedChainId !== BRADBURY_CHAIN_ID) {
    throw new Error(`Wallet is on chain ${switchedChainId}; GenLayer Bradbury requires ${BRADBURY_CHAIN_ID}.`)
  }
  return switchedChainId
}
