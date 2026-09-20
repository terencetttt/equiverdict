export type PolledReceipt = { status?: string; statusName?: string; txExecutionResultName?: string }

export class ReceiptPollingError extends Error {
  constructor(public readonly transactionHash: string, message = 'Receipt polling failed') {
    super(`${message}. Transaction ${transactionHash} may still be pending. Check its status again; do not resubmit.`)
    this.name = 'ReceiptPollingError'
  }
}

export async function pollReceipt(hash: string, status: string) {
  try {
    const response = await fetch('/api/genlayer/receipt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash, status }), cache: 'no-store', signal: AbortSignal.timeout(18000),
    })
    if (!response.ok) throw new Error('Polling server unavailable')
    const body = await response.json()
    if (!body.receipt || typeof body.receipt.statusName !== 'string') throw new Error('Invalid polling response')
    return body as { receipt: PolledReceipt; executionError?: string }
  } catch { throw new ReceiptPollingError(hash) }
}
