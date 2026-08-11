import { createClient } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'
import { ExecutionResult, TransactionStatus } from 'genlayer-js/types'
import { DisputeDraft, EvidenceItem, mapContractDispute } from './cases'
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

export const CONTRACT_ADDRESS = '0x1e3F5ffAa55c891b30b2b920eEE65E5e154b5aFe' as const

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
  if (message.length > 300 || /txCalldata|Raw Call Arguments|Traceback|\"abi\"|0x[0-9a-f]{64}/i.test(message)) {
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

export async function submitDispute(draft: DisputeDraft, evidence: Omit<EvidenceItem, 'id'>[]) {
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
  if (!address) throw new Error('Connect a wallet account before submitting the dispute.')

  const walletChainId = await ensureBradburyNetwork(provider)
  if (walletChainId !== BRADBURY_CHAIN_ID) {
    throw new Error(
      `Wallet is on chain ${walletChainId}; GenLayer Bradbury requires ${BRADBURY_CHAIN_ID} (${testnetBradbury.id}).`,
    )
  }

  const schema = await readClient.getContractSchema(CONTRACT_ADDRESS)
  const submitMethod = schema.methods?.submit_dispute
  const expectedParams = ['case_id', 'agreement', 'disputed_amount', 'client_evidence', 'freelancer_evidence']
  const actualParams = submitMethod?.params?.map(([name]) => name) ?? []
  if (submitMethod?.readonly !== false || actualParams.join(',') !== expectedParams.join(',')) {
    throw new Error(
      `Contract schema mismatch at ${CONTRACT_ADDRESS} on Bradbury: submit_dispute(${actualParams.join(', ') || 'missing'}).`,
    )
  }

  const writeClient = createClient({
    chain: testnetBradbury,
    account: address as `0x${string}`,
    provider,
  })
  const contractEvidence = evidence.map((item) => ({
    type: item.type,
    role: item.role,
    title: item.title,
    summary: item.summary,
    importance: item.importance,
    timestamp: item.timestamp,
    url: item.url,
  }))
  const clientEvidence = contractEvidence.filter((item) => item.role === 'client')
  const freelancerEvidence = contractEvidence.filter((item) => item.role === 'freelancer')

  const hash = await writeClient.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: 'submit_dispute',
    args: [
      draft.caseId,
      JSON.stringify(draft),
      draft.amount,
      clientEvidence,
      freelancerEvidence,
    ],
    value: BigInt(0),
  })

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
    throw new GenLayerConsensusError(String(hash))
  }
  if (outcome === 'execution_error') {
    let executionError = 'Contract execution failed without a trace message.'
    try {
      const trace = await readClient.debugTraceTransaction({ hash })
      executionError = conciseExecutionError(trace.stderr?.trim() || trace.stdout?.trim())
    } catch {
      executionError = 'The GenLayer contract could not evaluate this dispute.'
    }
    throw new GenLayerExecutionError(
      'Bradbury accepted the transaction, but contract execution failed.',
      String(hash),
      String(receipt.statusName ?? receipt.status ?? 'unknown'),
      executionError,
    )
  }
  if (outcome !== 'success' || receipt.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error('The dispute transaction did not complete successfully.')
  }

  return { hash: String(hash), caseId: draft.caseId }
}
