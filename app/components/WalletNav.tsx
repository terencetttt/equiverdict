'use client'

import { useEffect, useState } from 'react'
import {
  DiscoveredWallet,
  NO_WALLET_MESSAGE,
  WalletProvider,
  discoverWallets,
  ensureBradburyNetwork,
  setSelectedWalletProvider,
} from '../lib/wallet'
import { formatTransactionError } from '../lib/genlayer'

const chainNames: Record<string, string> = {
  '0x1': 'Ethereum Mainnet',
  '0x5': 'Goerli',
  '0xaa36a7': 'Sepolia',
  '0x89': 'Polygon',
  '0x38': 'BNB Chain',
  '0xa': 'Optimism',
  '0xa4b1': 'Arbitrum One',
  '0x2105': 'Base',
  '0x539': 'Local Hardhat',
  '0x107d': 'GenLayer Bradbury Testnet',
}

function formatAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export default function WalletNav() {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [provider, setProvider] = useState<WalletProvider | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [chainId, setChainId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    let active = true
    discoverWallets().then((found) => {
      if (!active) return
      setWallets(found)
      if (found.length) setSelectedId(found[0].id)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!provider) return
    const handleAccountsChanged = (accounts: unknown) => {
      const next = Array.isArray(accounts) ? accounts : []
      setAddress(next.length ? String(next[0]) : null)
      if (!next.length) setChainId(null)
    }
    const handleChainChanged = (nextChainId: unknown) => setChainId(String(nextChainId).toLowerCase())
    provider.on?.('accountsChanged', handleAccountsChanged)
    provider.on?.('chainChanged', handleChainChanged)
    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged)
      provider.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [provider])

  const connectWallet = async () => {
    const wallet = wallets.find((item) => item.id === selectedId)
    if (!wallet) {
      setError(NO_WALLET_MESSAGE)
      return
    }
    setConnecting(true)
    setError('')
    try {
      const accounts = (await wallet.provider.request({ method: 'eth_requestAccounts' })) as string[]
      if (!accounts?.[0]) throw new Error('The wallet did not return an account.')
      const connectedChainId = await ensureBradburyNetwork(wallet.provider)
      setProvider(wallet.provider)
      setSelectedWalletProvider(wallet.provider)
      setAddress(accounts[0])
      setChainId(connectedChainId)
    } catch (err) {
      setError(formatTransactionError(err))
    } finally {
      setConnecting(false)
    }
  }

  const disconnectWallet = () => {
    setProvider(null)
    setSelectedWalletProvider(null)
    setAddress(null)
    setChainId(null)
    setError('')
  }

  return (
    <div className="wallet-nav">
      {address ? (
        <div className="wallet-status">
          <div className="wallet-meta">
            <span className="wallet-label">Connected</span>
            <strong>{formatAddress(address)}</strong>
            <span>{chainNames[chainId ?? ''] ?? `Chain ${chainId}`}</span>
            <span className="wallet-chain">Chain ID: {chainId ?? 'unknown'}</span>
          </div>
          <button className="secondary wallet-action" onClick={disconnectWallet} type="button">Disconnect</button>
        </div>
      ) : (
        <div className="wallet-status">
          {wallets.length > 1 && (
            <select aria-label="Select wallet" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}
            </select>
          )}
          <button className="primary wallet-action" onClick={connectWallet} type="button" disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect Wallet'}
          </button>
        </div>
      )}
      {error ? <p className="wallet-error">{error}</p> : null}
    </div>
  )
}
