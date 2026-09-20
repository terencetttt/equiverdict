import { pollReceipt, ReceiptPollingError } from './receipt-polling'
import { submitOnce, clearPending, pendingTransactions, markPendingTimeout, type PendingWrite } from './pending-writes'
import { reconcileTransition, transitionObserved, type ExpectedTransition } from './reconciliation'
import { publishState, subscribeState } from './state-events'
import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { CalldataAddress, ExecutionResult, TransactionStatus } from 'genlayer-js/types'
import { type DisputeDraft, type EvidenceSubmission, mapContractDispute } from './cases'
import { canonicalAgreement } from './agreement'
import { requireContractAddress } from './contract-config'
import { disputeActions } from './lifecycle'
import {
  CONSENSUS_UNDETERMINED_MESSAGE,
  classifyTransactionReceipt,
} from './transaction-outcome'
import {
  STUDIONET_CHAIN_ID,
  NO_WALLET_MESSAGE,
  discoverWallets,
  ensureStudionetNetwork,
  getSelectedWalletProvider,
  setSelectedWalletProvider,
} from './wallet'

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS

function contractAddress() {
  return requireContractAddress(CONTRACT_ADDRESS)
}

function toCalldataAddress(address: `0x${string}`) {
  const hex = address.slice(2)
  const bytes = new Uint8Array(20)
  for (let index = 0; index < 20; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return new CalldataAddress(bytes)
}

const readClient = createClient({ chain: studionet })

function errorText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  for (const key of ['shortMessage', 'message', 'details', 'reason']) {
    const text = errorText(record[key])
    if (text) return text
  }
  const nested = errorText(record.error) ?? errorText(record.cause) ?? errorText(record.data)
  if (nested) return nested
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function formatTransactionError(error: unknown) {
  const message = errorText(error)
  if (!message) return 'Unable to complete the GenLayer transaction.'
  if (message.length > 500 || /txCalldata|Raw Call Arguments|Traceback|\"abi\"/i.test(message)) {
    return 'Unable to complete the GenLayer transaction. Please try again.'
  }
  return message
}

export class GenLayerExecutionError extends Error {
  constructor(
    message: string,
    public readonly transactionHash: string,
    public readonly receiptStatus: string,
    public readonly executionError: string,
  ) {
    super(message)
    this.name = 'GenLayerExecutionError'
  }
}

export class GenLayerConsensusError extends Error {
  constructor(public readonly transactionHash: string) {
    super(CONSENSUS_UNDETERMINED_MESSAGE)
    this.name = 'GenLayerConsensusError'
  }
}

async function selectedWallet() {
  let provider = getSelectedWalletProvider()
  if (!provider) {
    const wallets = await discoverWallets()
    const preferredWallet =
      wallets.find((wallet) => /rabby/i.test(wallet.name)) ??
      wallets[0]

    if (preferredWallet) {
      provider = preferredWallet.provider
      setSelectedWalletProvider(provider)
    }
  }
  if (!provider) throw new Error(NO_WALLET_MESSAGE)

  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
  const address = accounts?.[0]
  if (!address) throw new Error('Connect a wallet account before continuing.')

  const walletChainId = await ensureStudionetNetwork(provider)
  if (walletChainId !== STUDIONET_CHAIN_ID) {
    throw new Error(
      `Wallet is on chain ${walletChainId}; GenLayer Studionet requires ${STUDIONET_CHAIN_ID} (${studionet.id}).`,
    )
  }

  const client = createClient({
    chain: studionet,
    account: address as `0x${string}`,
    provider,
  })

  return { provider, address, client }
}

const REQUIRED_METHODS: Record<string, { params: string[]; readonly: boolean }> = {
  create_dispute: { params: ['case_id', 'freelancer_wallet', 'agreement', 'disputed_amount'], readonly: false },
  accept_agreement: { params: ['case_id', 'agreement_sha256'], readonly: false },
  submit_evidence: { params: ['case_id', 'evidence_type', 'title', 'description', 'importance', 'timestamp', 'evidence_uri', 'evidence_sha256', 'accepted_agreement_sha256'], readonly: false },
  freeze_evidence: { params: ['case_id'], readonly: false },
  evaluate_dispute: { params: ['case_id'], readonly: false },
  get_dispute: { params: ['case_id'], readonly: true },
  list_disputes: { params: [], readonly: true },
}

async function assertMethod(functionName: string, expectedParams: string[], readonly = false) {
  const schema = await readClient.getContractSchema(contractAddress())
  // Check the whole lifecycle before even creating a case on an older deployment.
  for (const [name, expected] of Object.entries(REQUIRED_METHODS)) {
    const method = schema.methods?.[name]
    const actualParams = method?.params?.map(([parameter]) => parameter) ?? []
    if (method?.readonly !== expected.readonly || actualParams.join(',') !== expected.params.join(',')) {
      throw new Error(`Contract schema mismatch at ${CONTRACT_ADDRESS} on Studionet: ${name}(${actualParams.join(', ') || 'missing'}). Corrected deployment verification is required.`)
    }
  }
  const expected = REQUIRED_METHODS[functionName]
  if (!expected || expected.readonly !== readonly || expected.params.join(',') !== expectedParams.join(',')) {
    throw new Error(`Frontend ABI mismatch for ${functionName}.`)
  }
}

export async function waitForWrite(hash: string, allowUndetermined = false) {
  const deadline = Date.now() + 300000
  for (let attempt = 0; attempt < 100 && Date.now() < deadline; attempt++) {
    const { receipt, executionError } = await pollReceipt(String(hash), TransactionStatus.ACCEPTED)
    const outcome = classifyTransactionReceipt(receipt)
    if (outcome === 'pending') {
      await new Promise(resolve => setTimeout(resolve, 3000))
      continue
    }
    if (outcome === 'undetermined') {
      if (allowUndetermined) throw new GenLayerConsensusError(String(hash))
      throw new Error('The Studionet transaction did not reach a determined execution result.')
    }
    if (outcome === 'execution_error') {
      throw new GenLayerExecutionError(
        'Studionet accepted the transaction, but contract execution failed.', String(hash),
        String(receipt.statusName ?? receipt.status ?? 'unknown'),
        executionError || 'The GenLayer contract transaction failed.',
      )
    }
    if (outcome !== 'success' || receipt.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
      throw new ReceiptPollingError(String(hash), 'Transaction result is not confirmed')
    }
    return receipt
  }
  throw new ReceiptPollingError(String(hash), 'Receipt polling timed out')
}

const confirmations = new Map<string, Promise<ReturnType<typeof mapContractDispute>>>()

export function recoverPendingTransaction(transaction: PendingWrite) {
  const existing = confirmations.get(transaction.hash)
  if (existing) return existing
  const work = (async () => {
    const expected = transaction.expected ?? { method: transaction.method, caseId: transaction.caseId, account: transaction.account }
    markPendingTimeout(transaction.hash, false)
    const controller = new AbortController()
    let unsubscribe = () => {}
    const observedElsewhere = new Promise<ReturnType<typeof mapContractDispute>>(resolve => {
      unsubscribe = subscribeState(event => {
        if (event.type === 'confirmed' && event.hash === transaction.hash && event.record) resolve(event.record)
      })
    })
    try {
      // Older evidence hashes lack a baseline. Keep their receipt check, then refresh state.
      if (!transaction.expected && transaction.method === 'submit_evidence') await waitForWrite(transaction.hash)
      const record = !transaction.expected && transaction.method === 'submit_evidence'
        ? await getDispute(transaction.caseId)
        : await Promise.race([observedElsewhere, reconcileTransition({ hash: transaction.hash, expected, read: () => getDispute(transaction.caseId),
          signal: controller.signal,
          observeReceipt: () => pollReceipt(transaction.hash, TransactionStatus.ACCEPTED),
          attempts: transaction.method === 'evaluate_dispute' ? 150 : 60,
          timeoutMs: transaction.method === 'evaluate_dispute' ? 300000 : 180000 })])
      if (pendingTransactions().some(tx => tx.hash === transaction.hash)) {
        clearPending(transaction.hash)
        publishState({ type: 'confirmed', caseId: transaction.caseId, method: transaction.method, hash: transaction.hash, record })
      }
      return record
    } catch (error) {
      markPendingTimeout(transaction.hash)
      throw error
    } finally { unsubscribe(); controller.abort() }
  })()
  confirmations.set(transaction.hash, work)
  void work.finally(() => confirmations.delete(transaction.hash)).catch(() => undefined)
  return work
}

async function submitWrite(client: Awaited<ReturnType<typeof selectedWallet>>['client'], call: Parameters<typeof client.writeContract>[0], expected: ExpectedTransition) {
  const key = JSON.stringify([CONTRACT_ADDRESS, client.account?.address, call.functionName, call.args?.[0]])
  const hash = await submitOnce(key, () => client.writeContract(call), expected)
  const transaction = pendingTransactions().find(item => item.hash === hash && item.caseId === expected.caseId)
  const record = await recoverPendingTransaction(transaction ?? { hash, contract: contractAddress(), account: expected.account, method: expected.method, caseId: expected.caseId, expected })
  return { hash: String(hash), record }
}

export async function listDisputes() {
  await assertMethod('list_disputes', [], true)
  const result = await readClient.readContract({
    address: contractAddress(),
    functionName: 'list_disputes',
    args: [],
  })
  return (result as unknown[]).map(mapContractDispute)
}

export async function getDispute(caseId: string) {
  await assertMethod('get_dispute', ['case_id'], true)
  const result = await readClient.readContract({
    address: contractAddress(),
    functionName: 'get_dispute',
    args: [caseId],
  })
  const record = mapContractDispute(result)
  // Background/focus reads can prove success even after the automatic deadline.
  for (const tx of pendingTransactions()) {
    if (tx.contract === CONTRACT_ADDRESS && tx.expected && transitionObserved(record, tx.expected)) {
      clearPending(tx.hash)
      publishState({ type: 'confirmed', caseId, method: tx.method, hash: tx.hash, record })
    }
  }
  return record
}

export async function getConnectedWalletAddress() {
  const { address } = await selectedWallet()
  return address
}

export async function createDispute(draft: DisputeDraft, expectedClientWallet: string) {
  contractAddress()
  const { address, client } = await selectedWallet()

  if (address.toLowerCase() !== expectedClientWallet.toLowerCase()) throw new Error('Client wallet changed. Refresh the wallet and review the agreement before creating the case.')
  if (!draft.terms.trim()) throw new Error('Agreement terms are required.')

  if (!/^0x[0-9a-fA-F]{40}$/.test(draft.freelancerWallet)) {
    throw new Error('Enter a valid freelancer wallet address.')
  }
  if (address.toLowerCase() === draft.freelancerWallet.toLowerCase()) {
    throw new Error('Client and freelancer must use different wallets.')
  }

  await assertMethod('create_dispute', [
    'case_id',
    'freelancer_wallet',
    'agreement',
    'disputed_amount',
  ])

  const result = await submitWrite(client, {
    address: contractAddress(),
    functionName: 'create_dispute',
    args: [
      draft.caseId,
      toCalldataAddress(draft.freelancerWallet as `0x${string}`),
      canonicalAgreement(draft, address),
      draft.amount,
    ],
    value: BigInt(0),
  }, { method: 'create_dispute', caseId: draft.caseId, account: address, agreement: canonicalAgreement(draft, address) })
  return { ...result, caseId: draft.caseId, clientWallet: address }
}

export async function submitEvidence(caseId: string, evidence: EvidenceSubmission) {
  contractAddress()
  const { client, address } = await selectedWallet()
  const record = await getDispute(caseId)
  if (!disputeActions(record, address).canSubmit) throw new Error('Evidence requires a bound party, mutual agreement acceptance, and an unfrozen case.')
  if (evidence.acceptedAgreementSha256 !== record.agreementSha256) throw new Error('Evidence must reference the mutually accepted agreement hash.')

  if (!evidence.url.startsWith('https://')) {
    throw new Error('Evidence URL must use HTTPS.')
  }
  if (!/^[0-9a-fA-F]{64}$/.test(evidence.evidenceSha256)) {
    throw new Error('Evidence SHA-256 must be exactly 64 hexadecimal characters.')
  }

  await assertMethod('submit_evidence', [
    'case_id',
    'evidence_type',
    'title',
    'description',
    'importance',
    'timestamp',
    'evidence_uri',
    'evidence_sha256',
    'accepted_agreement_sha256',
  ])

  const result = await submitWrite(client, {
    address: contractAddress(),
    functionName: 'submit_evidence',
    args: [
      caseId,
      evidence.type,
      evidence.title,
      evidence.summary,
      evidence.importance,
      evidence.timestamp,
      evidence.url,
      evidence.evidenceSha256.toLowerCase(),
      evidence.acceptedAgreementSha256,
    ],
    value: BigInt(0),
  }, { method: 'submit_evidence', caseId, account: address, agreementHash: record.agreementSha256,
    evidence, previousEvidenceIds: record.evidence.map(item => item.id) })
  return { ...result, caseId }
}

export async function acceptAgreement(caseId: string, agreementHash: string) {
  contractAddress()
  const { client, address } = await selectedWallet()
  const record = await getDispute(caseId)
  if (!disputeActions(record, address).canAccept || agreementHash !== record.agreementSha256) throw new Error('Only an unaccepted bound party can accept this exact agreement.')
  await assertMethod('accept_agreement', ['case_id', 'agreement_sha256'])
  const result = await submitWrite(client, {
    address: contractAddress(), functionName: 'accept_agreement', args: [caseId, agreementHash], value: BigInt(0),
  }, { method: 'accept_agreement', caseId, account: address, agreementHash,
    otherAccepted: address.toLowerCase() === record.clientWallet.toLowerCase() ? record.freelancerAgreementAccepted : record.clientAgreementAccepted })
  return { ...result, caseId }
}

export async function freezeEvidence(caseId: string) {
  contractAddress()
  const { client, address } = await selectedWallet()
  if (!disputeActions(await getDispute(caseId), address).canFreeze) throw new Error('Freezing requires mutual acceptance and evidence from both parties in an unfrozen case.')
  await assertMethod('freeze_evidence', ['case_id'])
  const result = await submitWrite(client, {
    address: contractAddress(), functionName: 'freeze_evidence', args: [caseId], value: BigInt(0),
  }, { method: 'freeze_evidence', caseId, account: address })
  return { ...result, caseId }
}

export async function evaluateDispute(caseId: string) {
  contractAddress()
  const { client, address } = await selectedWallet()
  if (!disputeActions(await getDispute(caseId), address).canEvaluate) throw new Error('Evaluation requires frozen evidence and a bound party.')
  await assertMethod('evaluate_dispute', ['case_id'])

  const result = await submitWrite(client, {
    address: contractAddress(),
    functionName: 'evaluate_dispute',
    args: [caseId],
    value: BigInt(0),
  }, { method: 'evaluate_dispute', caseId, account: address })
  return { ...result, caseId }
}
