import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CONSENSUS_UNDETERMINED_MESSAGE,
  classifyTransactionReceipt,
  conciseExecutionError,
  isCaseNotFoundError,
} from '../../app/lib/transaction-outcome.ts'

test('successful consensus is safe to navigate', () => {
  assert.equal(classifyTransactionReceipt({
    statusName: 'ACCEPTED',
    txExecutionResultName: 'FINISHED_WITH_RETURN',
  }), 'success')
})

test('UNDETERMINED consensus does not count as success', () => {
  assert.equal(classifyTransactionReceipt({
    statusName: 'UNDETERMINED',
    txExecutionResultName: 'NOT_VOTED',
  }), 'undetermined')
  assert.equal(
    CONSENSUS_UNDETERMINED_MESSAGE,
    'Validators could not reach consensus on this dispute. Add clearer evidence or agreement terms and try again.',
  )
})

test('FINISHED_WITH_ERROR produces a concise execution message', () => {
  assert.equal(classifyTransactionReceipt({
    statusName: 'ACCEPTED',
    txExecutionResultName: 'FINISHED_WITH_ERROR',
  }), 'execution_error')
  assert.equal(
    conciseExecutionError("Traceback (most recent call last):\nfoo\ngenlayer.gl.vm.UserError: UserError(message='Evidence role is invalid')"),
    'Evidence role is invalid',
  )
})

test('pending receipt continues waiting', () => {
  assert.equal(classifyTransactionReceipt({ statusName: 'PENDING' }), 'pending')
})

test('missing case is recognized without exposing RPC diagnostics', () => {
  assert.equal(isCaseNotFoundError(new Error('GenVM execution failed: Case not found')), true)
  assert.equal(isCaseNotFoundError(new Error('RPC temporarily unavailable')), false)
  assert.equal(conciseExecutionError('0x' + 'ab'.repeat(64)), 'The GenLayer contract could not evaluate this dispute.')
})
