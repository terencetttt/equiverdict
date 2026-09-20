import assert from 'node:assert/strict'
import test from 'node:test'
import { studionet } from 'genlayer-js/chains'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { client, freelancer, outsider, draft, record } from './dispute-fixtures.mjs'

// Read the real Python ABI without loading its SDK or making any network request.
const python = `import ast,json
from pathlib import Path
tree=ast.parse(Path('contracts/dispute_resolver.py').read_text())
cls=next(node for node in tree.body if isinstance(node,ast.ClassDef))
methods={}
for node in cls.body:
 if isinstance(node,ast.FunctionDef) and node.decorator_list:
  decorator=ast.unparse(node.decorator_list[0])
  if decorator in ('gl.public.write','gl.public.view'):
   methods[node.name]={'params':[[arg.arg,'test-type'] for arg in node.args.args[1:]],'readonly':decorator=='gl.public.view'}
print(json.dumps({'methods':methods}))`
const schema = JSON.parse(execFileSync('python', ['-c', python], { encoding: 'utf8' }))
const nodeRequire = createRequire(import.meta.url)

function harness(config = '0x' + '44'.repeat(20), storage = new Map()) {
  const state = { wallet: client, chain: '0xf22f', record: record(), schema: structuredClone(schema), writes: [], reads: [], schemas: 0, clients: [], walletRequests: [], polls: [], receipts: [], rpcError: null, fetchError: false, readError: null, lag: 0, nextLag: 0, missingReads: 0, beforeWrite: null }
  class CalldataAddress { constructor(bytes) { this.bytes = bytes } }
  const sdk = {
    getContractSchema: async () => { state.schemas++; return state.schema },
    readContract: async (call) => {
      state.reads.push(call)
      if (state.readError) throw state.readError
      if (call.functionName === 'get_dispute' && state.missingReads > 0) { state.missingReads--; throw new Error('Case not found') }
      if (state.beforeWrite && state.lag > 0 && call.functionName === 'get_dispute') { state.lag--; return structuredClone(state.beforeWrite) }
      return structuredClone(call.functionName === 'list_disputes' ? [state.record] : state.record)
    },
    writeContract: async (call) => {
      state.writes.push(call)
      state.beforeWrite = structuredClone(state.record)
      state.lag = state.nextLag
      if (call.functionName === 'accept_agreement') {
        state.record[state.wallet === client ? 'client_agreement_accepted' : 'freelancer_agreement_accepted'] = true
        if (state.record.client_agreement_accepted && state.record.freelancer_agreement_accepted) state.record.agreement_status = 'mutually_accepted'
      }
      if (call.functionName === 'submit_evidence') {
        const role = state.wallet === client ? 'client' : 'freelancer'
        const id = `evidence-${state.record.evidence_order.length + 1}`
        state.record[`${role}_evidence`].push({ evidence_id: id, role, submitting_wallet: state.wallet, evidence_type: call.args[1], title: call.args[2], description: call.args[3], importance: call.args[4], timestamp: call.args[5], evidence_uri: call.args[6], evidence_sha256: call.args[7], agreement_sha256: call.args[8] })
        state.record.evidence_order.push(id)
      }
      if (call.functionName === 'freeze_evidence') { state.record.evidence_frozen = true; state.record.evidence_root = 'c'.repeat(64) }
      if (call.functionName === 'evaluate_dispute') { state.record.status = 'evaluated'; state.record.verdict = { verdict_category: 'split_payment', decision_label: 'Split', explanation: ['Evidence supports partial delivery.'], payment_split: { client: 50, freelancer: 50 } } }
      return '0x' + 'ab'.repeat(32)
    },
    waitForTransactionReceipt: async (call) => { state.polls.push(call); if (state.rpcError) throw state.rpcError; return state.receipts.shift() ?? { statusName: 'ACCEPTED', txExecutionResultName: 'FINISHED_WITH_RETURN' } },
    debugTraceTransaction: async () => ({ stderr: 'UserError(message=\"Evidence unavailable\")' }),
  }
  const mocks = {
    'genlayer-js': { createClient: (options) => { state.clients.push(options); return { ...sdk, account: options.account ? { address: options.account } : undefined } } },
    'genlayer-js/chains': { studionet },
    'genlayer-js/types': { CalldataAddress, ExecutionResult: { FINISHED_WITH_RETURN: 'FINISHED_WITH_RETURN' }, TransactionStatus: { ACCEPTED: 'ACCEPTED' } },
  }
  const cache = new Map()
  function load(path) {
    if (cache.has(path)) return cache.get(path)
    // Node's built-in transform supports constructor parameter properties.
    // This tiny adapter replaces only this app's named ESM imports/exports so
    // the actual implementation can run with isolated SDK/wallet mocks.
    let output = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'transform' })
    const names = [...output.matchAll(/export (?:async )?(?:function|class|const) (\w+)/g)].map((match) => match[1])
    output = output.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g, (_, bindings, source) => `const {${bindings.replace(/\bas\b/g, ':')}} = require('${source}');`)
    output = output.replace(/\bexport (?=(?:async )?(?:function|class|const) )/g, '')
    output += `\nObject.assign(module.exports, {${names.join(',')}});`
    const module = { exports: {} }
    cache.set(path, module.exports)
    const require = (name) => mocks[name] ?? (name.startsWith('.') ? load(resolve(dirname(path), name + '.ts')) : nodeRequire(name))
    const fetchReceipt = async (url, options) => {
      assert.equal(url, '/api/genlayer/receipt')
      assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), ['hash', 'status'])
      if (state.fetchError) throw new Error('Failed to fetch')
      return load(resolve('app/api/genlayer/receipt/route.ts')).POST(new Request('http://localhost' + url, options))
    }
    new Function('require', 'module', 'exports', 'process', 'fetch', 'setTimeout', 'sessionStorage', output)(require, module, module.exports, { env: { NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS: config } }, fetchReceipt, path.endsWith('route.ts') ? setTimeout : (fn) => setTimeout(fn, 0), { get length() { return storage.size }, key: i => [...storage.keys()][i] ?? null, getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) })
    return module.exports
  }
  const wallet = load(resolve('app/lib/wallet.ts'))
  const handlers = new Map()
  const provider = { on: (event, fn) => { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(fn) }, removeListener: (event, fn) => handlers.get(event)?.delete(fn), request: async (call) => {
    state.walletRequests.push(call)
    if (call.method === 'eth_chainId') return state.chain
    if (['eth_requestAccounts', 'eth_accounts'].includes(call.method)) return [state.wallet]
    throw new Error('Unexpected wallet request: ' + call.method)
  } }
  wallet.setSelectedWalletProvider(provider)
  return { provider, emitWallet: event => { for (const fn of handlers.get(event) ?? []) fn() }, loadModule: name => load(resolve(name)), api: load(resolve('app/lib/genlayer.ts')), route: () => load(resolve('app/api/genlayer/receipt/route.ts')), state, CalldataAddress }
}
const submission = (hash) => ({ type: 'document', title: 'Delivery', summary: 'Half complete', importance: 'high', timestamp: '2026-09-19', url: 'https://example.test/proof.txt', evidenceSha256: 'a'.repeat(64), acceptedAgreementSha256: hash })

test('all frontend writes match current Python ABI, including accepted hash and freeze', async () => {
  const { api, state, CalldataAddress } = harness()
  assert.equal(await api.getConnectedWalletAddress(), client)
  await api.createDispute(draft, client)
  const creation = state.writes[0]
  assert.equal(creation.functionName, 'create_dispute')
  assert.ok(creation.args[1] instanceof CalldataAddress)
  assert.equal(Buffer.from(creation.args[1].bytes).toString('hex'), freelancer.slice(2))
  assert.equal(creation.args[2], state.record.agreement)
  assert.equal(creation.args[3], draft.amount)
  const hash = state.record.agreement_sha256
  await api.acceptAgreement(draft.caseId, hash)
  state.wallet = freelancer
  await api.acceptAgreement(draft.caseId, hash)
  await api.submitEvidence(draft.caseId, submission(hash))
  state.wallet = client
  await api.submitEvidence(draft.caseId, submission(hash))
  await api.freezeEvidence(draft.caseId)
  await api.evaluateDispute(draft.caseId)
  for (const call of state.writes) {
    assert.equal(call.args.length, schema.methods[call.functionName].params.length)
    assert.equal(call.address, '0x' + '44'.repeat(20))
    assert.equal(call.value, 0n)
  }
  assert.deepEqual(state.writes.find((call) => call.functionName === 'accept_agreement').args, [draft.caseId, hash])
  assert.deepEqual(state.writes.find((call) => call.functionName === 'submit_evidence').args, [draft.caseId, 'document', 'Delivery', 'Half complete', 'high', '2026-09-19', 'https://example.test/proof.txt', 'a'.repeat(64), hash])
  assert.deepEqual(state.writes.find((call) => call.functionName === 'freeze_evidence').args, [draft.caseId])
  assert.deepEqual(state.writes.find((call) => call.functionName === 'evaluate_dispute').args, [draft.caseId])
  await api.listDisputes()
  assert.ok(state.reads.some((call) => call.functionName === 'list_disputes' && call.args.length === 0))
  assert.ok(state.reads.every((call) => ['list_disputes', 'get_dispute'].includes(call.functionName)))
  assert.ok(state.clients.every(({ chain }) => chain === studionet))
  assert.equal(studionet.id, 61999)
  assert.deepEqual(studionet.rpcUrls.default.http, ['https://studio.genlayer.com/api'])
  assert.ok(state.walletRequests.every(({ method }) => !method.startsWith('wallet_')))
  assert.ok(state.clients.filter(({ account }) => account).every(({ provider }) => provider))
})

test('old submit signature or missing freeze is rejected before case creation', async () => {
  for (const change of ['oldSubmit', 'noFreeze']) {
    const { api, state } = harness()
    if (change === 'oldSubmit') state.schema.methods.submit_evidence.params.pop()
    else delete state.schema.methods.freeze_evidence
    await assert.rejects(api.createDispute(draft, client), /schema mismatch/)
    assert.equal(state.writes.length, 0)
  }
})

test('write guards reject outsider, wrong agreement, early evidence and unfrozen evaluation', async () => {
  const { api, state } = harness()
  state.wallet = outsider
  await assert.rejects(api.acceptAgreement(draft.caseId, state.record.agreement_sha256), /bound party/)
  state.wallet = client
  await assert.rejects(api.acceptAgreement(draft.caseId, 'b'.repeat(64)), /exact agreement/)
  await assert.rejects(api.submitEvidence(draft.caseId, submission(state.record.agreement_sha256)), /mutual agreement/)
  await assert.rejects(api.freezeEvidence(draft.caseId), /mutual acceptance/)
  await assert.rejects(api.evaluateDispute(draft.caseId), /frozen evidence/)
  state.record.client_agreement_accepted = state.record.freelancer_agreement_accepted = true
  state.record.agreement_status = 'mutually_accepted'
  await assert.rejects(api.submitEvidence(draft.caseId, submission('b'.repeat(64))), /agreement hash/)
  state.record.evidence_frozen = true
  await assert.rejects(api.submitEvidence(draft.caseId, submission(state.record.agreement_sha256)), /unfrozen case/)
  assert.equal(state.writes.length, 0)
})

test('missing configuration fails closed before RPC; wallet change prevents a different agreement', async () => {
  const { api, state } = harness('')
  await assert.rejects(api.getDispute(draft.caseId), /pending configuration/)
  await assert.rejects(api.createDispute(draft, client), /pending configuration/)
  assert.equal(state.schemas, 0)
  assert.equal(state.writes.length, 0)
  const changed = harness()
  changed.state.wallet = outsider
  await assert.rejects(changed.api.createDispute(draft, client), /wallet changed/)
  assert.equal(changed.state.writes.length, 0)
})

const txHash = '0x' + 'ab'.repeat(32)

test('server polling handles pending then success without wallet submission', async () => {
  const { api, state } = harness()
  state.receipts.push({ statusName: 'PENDING' })
  await api.waitForWrite(txHash)
  assert.equal(state.polls.length, 2)
  assert.equal(state.writes.length, 0)
  assert.ok(state.polls.every(call => call.hash === txHash && call.retries === 0))
})

test('server polling preserves FINISHED_WITH_ERROR and its concise trace', async () => {
  const { api, state } = harness()
  state.receipts.push({ statusName: 'ACCEPTED', txExecutionResultName: 'FINISHED_WITH_ERROR' })
  await assert.rejects(api.waitForWrite(txHash), error => {
    assert.ok(error instanceof api.GenLayerExecutionError)
    assert.equal(error.transactionHash, txHash)
    assert.equal(error.executionError, 'Evidence unavailable')
    return true
  })
  assert.equal(state.writes.length, 0)
})

test('server polling preserves UNDETERMINED consensus', async () => {
  const { api, state } = harness()
  state.receipts.push({ statusName: 'UNDETERMINED' })
  await assert.rejects(api.waitForWrite(txHash, true), api.GenLayerConsensusError)
  assert.equal(state.writes.length, 0)
})

test('RPC and server failures retain hash; retry checks the original write', async () => {
  for (const failure of ['rpcError', 'fetchError']) {
    const { api, state } = harness()
    state[failure] = failure === 'rpcError' ? new Error('RPC disconnected') : true
    state.readError = new Error('State not visible yet')
    await assert.rejects(api.createDispute(draft, client), error => error.transactionHash === txHash && /do not submit again/.test(error.message))
    assert.equal(state.writes.length, 1)
    state[failure] = failure === 'rpcError' ? null : false
    state.readError = null
    await api.createDispute(draft, client)
    assert.equal(state.writes.length, 1)
  }
})

test('receipt route validates input and represents SDK pending timeout as HTTP 202', async () => {
  const { route, state } = harness()
  const post = body => route().POST(new Request('http://localhost/api/genlayer/receipt', { method: 'POST', body: JSON.stringify(body) }))
  assert.equal((await post({ hash: 'bad', status: 'ACCEPTED' })).status, 400)
  assert.equal((await post({ hash: txHash, status: 'BAD' })).status, 400)
  assert.equal((await post({ hash: txHash, status: 'ACCEPTED', rpc: 'https://other.test' })).status, 400)
  assert.equal(state.polls.length, 0)
  state.rpcError = new Error(`Timed out waiting for transaction ${txHash} to reach status "ACCEPTED" (current status: 0).`)
  const response = await post({ hash: txHash, status: 'ACCEPTED' })
  assert.equal(response.status, 202)
  assert.equal((await response.json()).receipt.statusName, 'PENDING')
  state.rpcError = new Error('private RPC diagnostic')
  const failure = await post({ hash: txHash, status: 'ACCEPTED' })
  assert.equal(failure.status, 502)
  assert.doesNotMatch(await failure.text(), /private RPC diagnostic/)
})

test('pending write survives reload and recovery never signs again', async () => {
  const storage = new Map()
  const first = harness(undefined, storage)
  first.state.fetchError = true
  first.state.readError = new Error('State not visible yet')
  await assert.rejects(first.api.createDispute(draft, client), /do not submit again/)
  assert.equal(storage.size, 1)
  const reloaded = harness(undefined, storage)
  await reloaded.api.recoverPendingTransaction(reloaded.loadModule('app/lib/pending-writes.ts').pendingTransactions()[0])
  assert.equal(reloaded.state.writes.length, 0)
  assert.equal(reloaded.state.walletRequests.length, 0)
  assert.equal(storage.size, 0)
})

test('concurrent create calls share a single wallet submission', async () => {
  const { api, state } = harness()
  await Promise.all([api.createDispute(draft, client), api.createDispute(draft, client)])
  assert.equal(state.writes.length, 1)
})

for (const party of ['client', 'freelancer']) {
  test(`${party} acceptance and mutually_accepted reconcile delayed state without refresh`, async () => {
    const { api, state } = harness()
    state.wallet = party === 'client' ? client : freelancer
    state.record[party === 'client' ? 'freelancer_agreement_accepted' : 'client_agreement_accepted'] = true
    state.nextLag = 3
    const result = await api.acceptAgreement(draft.caseId, state.record.agreement_sha256)
    assert.equal(result.record.clientAgreementAccepted, true)
    assert.equal(result.record.freelancerAgreementAccepted, true)
    assert.equal(result.record.agreementStatus, 'mutually_accepted')
    assert.ok(state.reads.filter(call => call.functionName === 'get_dispute').length >= 4)
    assert.equal(state.writes.length, 1)
  })
}

test('first acceptance reconciles without waiting for the other party', async () => {
  const { api, state } = harness()
  state.nextLag = 2
  const result = await api.acceptAgreement(draft.caseId, state.record.agreement_sha256)
  assert.equal(result.record.clientAgreementAccepted, true)
  assert.equal(result.record.freelancerAgreementAccepted, false)
})

test('new evidence, freeze, and verdict each reconcile delayed state automatically', async () => {
  const { api, state } = harness()
  state.record.client_agreement_accepted = state.record.freelancer_agreement_accepted = true
  state.record.agreement_status = 'mutually_accepted'
  state.nextLag = 3
  const evidence = await api.submitEvidence(draft.caseId, submission(state.record.agreement_sha256))
  assert.equal(evidence.record.evidence.length, 1)
  assert.equal(evidence.record.evidence[0].evidenceSha256, 'a'.repeat(64))
  state.wallet = freelancer
  state.nextLag = 3
  await api.submitEvidence(draft.caseId, submission(state.record.agreement_sha256))
  state.nextLag = 3
  const frozen = await api.freezeEvidence(draft.caseId)
  assert.equal(frozen.record.evidenceFrozen, true)
  assert.ok(frozen.record.evidenceRoot)
  state.nextLag = 3
  const evaluated = await api.evaluateDispute(draft.caseId)
  assert.equal(evaluated.record.status, 'evaluated')
  assert.equal(evaluated.record.verdict.outcome, 'split_payment')
  assert.ok(evaluated.record.verdict.explanation.length)
})

test('receipt failure cannot veto successful authoritative reconciliation', async () => {
  const { api, state } = harness()
  state.fetchError = true
  state.nextLag = 3
  const result = await api.acceptAgreement(draft.caseId, state.record.agreement_sha256)
  assert.equal(result.record.clientAgreementAccepted, true)
  assert.equal(state.writes.length, 1)
})

test('observing state after automatic timeout clears pending protection without another write', async () => {
  const { api, state, loadModule } = harness()
  state.readError = new Error('Temporary read outage')
  await assert.rejects(api.createDispute(draft, client), /Check status/)
  assert.equal(loadModule('app/lib/pending-writes.ts').pendingTransactions().length, 1)
  state.readError = null
  await api.getDispute(draft.caseId)
  assert.equal(loadModule('app/lib/pending-writes.ts').pendingTransactions().length, 0)
  assert.equal(state.writes.length, 1)
})

test('wallet account/chain changes and Rabby focus/visibility refresh role and case, then clean up', async () => {
  const { api, state, provider, emitWallet, loadModule } = harness()
  const { watchLiveState } = loadModule('app/lib/live-refresh.ts')
  const { getWalletAddress } = loadModule('app/lib/wallet.ts')
  const { disputeActions } = loadModule('app/lib/lifecycle.ts')
  const win = new EventTarget()
  const doc = new EventTarget()
  doc.visibilityState = 'visible'
  let role = null
  let refreshes = 0
  const stop = watchLiveState(async () => {
    const [record, address] = await Promise.all([api.getDispute(draft.caseId), getWalletAddress()])
    role = disputeActions(record, address).role
    refreshes++
  }, { window: win, document: doc, getProvider: () => provider, onWalletInvalidated: () => { role = null }, intervalMs: 100000 })
  const tick = () => new Promise(resolve => setTimeout(resolve, 10))
  try {
    await tick()
    assert.equal(role, 'client')
    state.wallet = freelancer
    emitWallet('accountsChanged')
    assert.equal(role, null)
    await tick()
    assert.equal(role, 'freelancer')
    let before = refreshes
    state.chain = '0x1'
    emitWallet('chainChanged')
    await tick()
    assert.ok(refreshes > before)
    assert.equal(role, null)
    state.chain = '0xf22f'
    emitWallet('chainChanged')
    await tick()
    assert.equal(role, 'freelancer')
    before = refreshes
    win.dispatchEvent(new Event('focus'))
    await tick()
    assert.ok(refreshes > before)
    before = refreshes
    doc.dispatchEvent(new Event('visibilitychange'))
    await tick()
    assert.ok(refreshes > before)
    assert.ok(state.walletRequests.every(call => !['eth_requestAccounts', 'wallet_switchEthereumChain'].includes(call.method)))
  } finally { stop() }
  const before = refreshes
  win.dispatchEvent(new Event('focus'))
  emitWallet('accountsChanged')
  await tick()
  assert.equal(refreshes, before)
})

test('creation locates the case despite initial not-found reads', async () => {
  const { api, state } = harness()
  state.missingReads = 3
  const result = await api.createDispute(draft, client)
  assert.equal(result.record.id, draft.caseId)
  assert.equal(result.record.clientWallet, client)
  assert.equal(state.reads.filter(call => call.functionName === 'get_dispute').length, 4)
  assert.equal(state.writes.length, 1)
})

test('second acceptance requires mutually_accepted, and existing evidence cannot prove a new submission', async () => {
  const { api, state, loadModule } = harness()
  const { transitionObserved } = loadModule('app/lib/reconciliation.ts')
  state.record.client_agreement_accepted = state.record.freelancer_agreement_accepted = true
  let mapped = await api.getDispute(draft.caseId)
  const expected = { method: 'accept_agreement', caseId: draft.caseId, account: client, otherAccepted: true }
  assert.equal(transitionObserved(mapped, expected), false)
  state.record.agreement_status = 'mutually_accepted'
  mapped = await api.getDispute(draft.caseId)
  assert.equal(transitionObserved(mapped, expected), true)
  const submitted = await api.submitEvidence(draft.caseId, submission(mapped.agreementSha256))
  assert.equal(transitionObserved(submitted.record, { method: 'submit_evidence', caseId: draft.caseId, account: client,
    evidence: submission(mapped.agreementSha256), previousEvidenceIds: submitted.record.evidence.map(item => item.id) }), false)
})

test('a stalled receipt request never blocks contract proof and obsolete reads can be cancelled', async () => {
  const { api, loadModule } = harness()
  const { reconcileTransition, boundedRead } = loadModule('app/lib/reconciliation.ts')
  const record = await api.getDispute(draft.caseId)
  const result = await reconcileTransition({ hash: txHash,
    expected: { method: 'create_dispute', caseId: draft.caseId, account: client },
    read: async () => record, observeReceipt: () => new Promise(() => {}), attempts: 1 })
  assert.equal(result.id, draft.caseId)
  const controller = new AbortController()
  const obsolete = boundedRead(() => new Promise(() => {}), 10000, controller.signal)
  controller.abort(new Error('State was already confirmed'))
  await assert.rejects(obsolete, /already confirmed/)
})
