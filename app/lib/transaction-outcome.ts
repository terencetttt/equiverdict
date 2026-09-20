export const CONSENSUS_UNDETERMINED_MESSAGE =
  'Validators could not reach consensus on this dispute. The frozen evidence is unchanged. Retry evaluation, or create a new case if agreement terms or evidence need to change.'

type ReceiptLike = {
  status?: unknown
  statusName?: unknown
  status_name?: unknown
  txExecutionResultName?: unknown
  tx_execution_result_name?: unknown
}

export type TransactionOutcome = 'success' | 'undetermined' | 'execution_error' | 'pending'

export function classifyTransactionReceipt(receipt: ReceiptLike): TransactionOutcome {
  const status = String(receipt.statusName ?? receipt.status_name ?? receipt.status ?? '').toUpperCase()
  const execution = String(
    receipt.txExecutionResultName ?? receipt.tx_execution_result_name ?? '',
  ).toUpperCase()

  if (status === 'UNDETERMINED' || status === '6') return 'undetermined'
  if (execution === 'FINISHED_WITH_ERROR' || execution === '2') return 'execution_error'
  if (execution === 'FINISHED_WITH_RETURN' || execution === '1') return 'success'
  return 'pending'
}

export function conciseExecutionError(value: unknown): string {
  const text = typeof value === 'string' ? value : ''
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const lastLine = lines[lines.length - 1] ?? ''
  const userMessage = lastLine.match(/UserError\(message=['"](.+?)['"]\)/)?.[1]
  const candidate = userMessage ?? lastLine.replace(/^[\w.]+(?:Error)?:\s*/, '')

  if (!candidate || candidate.length > 300 || /0x[0-9a-f]{64}|Traceback|txCalldata|Raw Call/i.test(candidate)) {
    return 'The GenLayer contract could not evaluate this dispute.'
  }
  return candidate
}

export function isCaseNotFoundError(value: unknown): boolean {
  const text = value instanceof Error ? value.message : String(value ?? '')
  return /case not found/i.test(text)
}
