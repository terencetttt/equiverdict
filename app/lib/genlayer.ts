import { createClient } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'
import { CalldataAddress, ExecutionResult, TransactionStatus } from 'genlayer-js/types'
import { DisputeDraft, EvidenceSubmission, mapContractDispute } from './cases'
import {
  CONSENSUS_UNDETERMINED_MESSAGE,
  classifyTransactionReceipt,
  conciseExecutionError,
} from './transaction-outcome'
import {
  BRADBURY_CHAIN_ID,
  NO_WALLET_MESSAGE,
  discoverWallets,
  ensureBradburyNetwork,
  getSelectedWalletProvider,
  setSelectedWalletProvider,
} from './wallet'

export const CONTRACT_ADDRESS = '0x6dD436Fe2Cb40486f7D60Ca02161B05f90B319ce' as const

function toCalldataAddress(address: `0x${string}`) {
  const hex = address.slice(2)
  const bytes = new Uint8Array(20)
  for (let index = 0; index < 20; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return new CalldataAddress(bytes)
}

const readClient = createClient({ chain: testnetBradbury })

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
    if (wallets.length === 1) {
      provider = wallets[0].provider
      setSelectedWalletProvider(provider)
    }
  }
  if (!provider) throw new Error(NO_WALLET_MESSAGE)

  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
  const address = accounts?.[0]
  if (!address) throw new Error('Connect a wallet account before continuing.')

  const walletChainId = await ensureBradburyNetwork(provider)
  if (walletChainId !== BRADBURY_CHAIN_ID) {
    throw new Error(
      `Wallet is on chain ${walletChainId}; GenLayer Bradbury requires ${BRADBURY_CHAIN_ID} (${testnetBradbury.id}).`,
    )
  }

  const client = createClient({
    chain: testnetBradbury,
    account: address as `0x${string}`,
    provider,
  })

  return { provider, address, client }
}

async function assertMethod(functionName: string, expectedParams: string[]) {
  const schema = await readClient.getContractSchema(CONTRACT_ADDRESS)
  const method = schema.methods?.[functionName]
  const actualParams = method?.params?.map(([name]) => name) ?? []
  if (method?.readonly !== false || actualParams.join(',') !== expectedParams.join(',')) {
    throw new Error(
      `Contract schema mismatch at ${CONTRACT_ADDRESS} on Bradbury: ${functionName}(${actualParams.join(', ') || 'missing'}).`,
    )
  }
}

type TransactionHash = Parameters<typeof readClient.waitForTransactionReceipt>[0]['hash']

async function waitForWrite(hash: TransactionHash, allowUndetermined: boolean) {
  let receipt = await readClient.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    interval: 3000,
    retries: 100,
  })

  let outcome = classifyTransactionReceipt(receipt)
  while (outcome === 'pending') {
    receipt = await readClient.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.ACCEPTED,
      interval: 3000,
      retries: 100,
    })
    outcome = classifyTransactionReceipt(receipt)
  }

  if (outcome === 'undetermined') {
    if (allowUndetermined) throw new GenLayerConsensusError(String(hash))
    throw new Error('The Bradbury transaction did not reach a determined execution result.')
  }

  if (outcome === 'execution_error') {
    let executionError = 'Contract execution failed without a trace message.'
    try {
      const trace = await readClient.debugTraceTransaction({ hash })
      executionError = conciseExecutionError(trace.stderr?.trim() || trace.stdout?.trim())
    } catch {
      executionError = 'The GenLayer contract transaction failed.'
    }
    throw new GenLayerExecutionError(
      'Bradbury accepted the transaction, but contract execution failed.',
      String(hash),
      String(receipt.statusName ?? receipt.status ?? 'unknown'),
      executionError,
    )
  }

  if (outcome !== 'success' || receipt.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error('The GenLayer transaction did not complete successfully.')
  }

  return receipt
}

export async function listDisputes() {
  const result = await readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: 'list_disputes',
    args: [],
  })
  return (result as unknown[]).map(mapContractDispute)
}

export async function getDispute(caseId: string) {
  const result = await readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: 'get_dispute',
    args: [caseId],
  })
  return mapContractDispute(result)
}

export async function getConnectedWalletAddress() {
  const { address } = await selectedWallet()
  return address
}

export async function createDispute(draft: DisputeDraft) {
  const { address, client } = await selectedWallet()

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

  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: 'create_dispute',
    args: [
      draft.caseId,
      toCalldataAddress(draft.freelancerWallet as `0x${string}`),
      JSON.stringify(draft),
      draft.amount,
    ],
    value: BigInt(0),
  })

  await waitForWrite(hash, false)
  return { hash: String(hash), caseId: draft.caseId, clientWallet: address }
}

export async function submitEvidence(caseId: string, evidence: EvidenceSubmission) {
  const { client } = await selectedWallet()

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
  ])

  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
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
    ],
    value: BigInt(0),
  })

  await waitForWrite(hash, false)
  return { hash: String(hash), caseId }
}

export async function evaluateDispute(caseId: string) {
  const { client } = await selectedWallet()
  await assertMethod('evaluate_dispute', ['case_id'])

  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: 'evaluate_dispute',
    args: [caseId],
    value: BigInt(0),
  })

  await waitForWrite(hash, true)

  // Bradbury may expose an ACCEPTED receipt before validator consensus is
  // actually final. Do not report success or let the UI clear the draft
  // until the contract state itself proves that evaluation was committed.
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const chainCase = await getDispute(caseId)
    if (chainCase.status === 'evaluated') {
      return { hash: String(hash), caseId }
    }

    try {
      const tx = await readClient.getTransaction({ hash })
      const txRecord = tx as unknown as Record<string, unknown>
      const finalityText = [
        txRecord.statusName,
        txRecord.status,
        txRecord.resultName,
        txRecord.result,
      ].map((value) => String(value ?? '')).join(' ')

      if (/undetermined/i.test(finalityText)) {
        throw new GenLayerConsensusError(String(hash))
      }
    } catch (error) {
      if (error instanceof GenLayerConsensusError) throw error
      // A temporary transaction-read failure must not be treated as success.
    }

    await new Promise((resolve) => window.setTimeout(resolve, 3000))
  }

  // If Bradbury never commits `evaluated`, preserve the dispute draft and
  // surface an unresolved-consensus result instead of navigating to 0/0.
  throw new GenLayerConsensusError(String(hash))
}
