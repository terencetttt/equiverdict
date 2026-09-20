import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { TransactionStatus } from 'genlayer-js/types'
import { classifyTransactionReceipt, conciseExecutionError } from '../../../lib/transaction-outcome'

export const runtime = 'nodejs'
export const maxDuration = 20
const client = createClient({ chain: studionet })

async function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('RPC deadline exceeded')), ms)
    })])
  } finally { clearTimeout(timer) }
}

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  let body
  try { body = await request.json() } catch { return reply({ error: 'Invalid JSON.' }, 400) }
  if (!body || typeof body.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(body.hash)
    || ![TransactionStatus.ACCEPTED, TransactionStatus.FINALIZED].includes(body.status)
    || Object.keys(body).some(key => !['hash', 'status'].includes(key))) {
    return reply({ error: 'Provide only a transaction hash and ACCEPTED or FINALIZED status.' }, 400)
  }
  const hash = body.hash as Parameters<typeof client.waitForTransactionReceipt>[0]['hash']
  try {
    // One bounded observation per request; the browser schedules subsequent checks.
    const receipt = await bounded(client.waitForTransactionReceipt({ hash, status: body.status, retries: 0, interval: 0 }), 12000)
    let executionError: string | undefined
    if (classifyTransactionReceipt(receipt) === 'execution_error') {
      executionError = 'The GenLayer contract transaction failed.'
      try {
        const trace = await bounded(client.debugTraceTransaction({ hash }), 3000)
        executionError = conciseExecutionError(trace.stderr?.trim() || trace.stdout?.trim())
      } catch { /* Trace availability must not hide the execution result. */ }
    }
    // Send only JSON-safe lifecycle fields; SDK receipts may contain bigint data.
    return reply({ receipt: {
      status: receipt.status == null ? undefined : String(receipt.status),
      statusName: receipt.statusName,
      txExecutionResultName: receipt.txExecutionResultName,
    }, executionError })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.startsWith(`Timed out waiting for transaction ${hash} to reach status`)
      || message === `Transaction not found: ${hash}`) {
      return reply({ receipt: { statusName: 'PENDING' } }, 202)
    }
    return reply({ error: 'Receipt polling is unavailable. Check this transaction again; do not resubmit it.' }, message === 'RPC deadline exceeded' ? 504 : 502)
  }
}
