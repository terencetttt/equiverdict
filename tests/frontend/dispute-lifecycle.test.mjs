import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mapContractDispute } from '../../app/lib/cases.ts'
import { canonicalAgreement, agreementSha256, AGREEMENT_VERSION } from '../../app/lib/agreement.ts'
import { disputeActions } from '../../app/lib/lifecycle.ts'
import { requireContractAddress } from '../../app/lib/contract-config.ts'

import { client, freelancer, outsider, draft, record, evidence } from './dispute-fixtures.mjs'

test('canonical agreement is stable, versioned and hashes exactly the sent UTF-8 bytes', async () => {
  const reversedKeys = Object.fromEntries(Object.entries(draft).reverse())
  const text = canonicalAgreement(draft, client)
  assert.equal(canonicalAgreement(reversedKeys, client), text)
  assert.equal(JSON.parse(text).version, AGREEMENT_VERSION)
  assert.equal(JSON.parse(text).terms, draft.terms)
  assert.equal(await agreementSha256(text), createHash('sha256').update(text, 'utf8').digest('hex'))
  assert.notEqual(await agreementSha256(canonicalAgreement({ ...draft, terms: 'Different terms' }, client)), await agreementSha256(text))
})

test('lifecycle guards require both parties, both evidence buckets, freeze and bound wallet', () => {
  const raw = record()
  const actions = (wallet = client, pending = false) => disputeActions(mapContractDispute(raw), wallet, pending)
  assert.equal(actions().canAccept, true)
  assert.equal(actions().canSubmit, false)
  assert.equal(actions().canFreeze, false)
  raw.client_agreement_accepted = true
  assert.equal(actions().canAccept, false)
  assert.equal(actions(freelancer).canAccept, true)
  assert.equal(actions().canSubmit, false)
  raw.freelancer_agreement_accepted = true
  raw.agreement_status = 'mutually_accepted'
  assert.equal(actions().canSubmit, true)
  assert.equal(actions().canFreeze, false)
  raw.client_evidence.push(evidence('client', 'evidence-1'))
  assert.equal(actions().canFreeze, false)
  raw.freelancer_evidence.push(evidence('freelancer', 'evidence-2'))
  assert.equal(actions().canFreeze, true)
  assert.equal(actions().canEvaluate, false)
  raw.evidence_frozen = true
  raw.evidence_root = 'c'.repeat(64)
  assert.equal(actions().canSubmit, false)
  assert.equal(actions().canFreeze, false)
  assert.equal(actions().canEvaluate, true)
  for (const result of [actions(outsider), actions(client, true)]) {
    for (const name of ['canAccept', 'canSubmit', 'canFreeze', 'canEvaluate']) assert.equal(result[name], false)
  }
  raw.status = 'evaluated'
  assert.equal(actions().canEvaluate, false)
  assert.equal(actions().canSubmit, false)
})

test('case reads retain contract IDs, ordered provenance, acceptance, root and full verdict', () => {
  const raw = record()
  raw.client_evidence = [evidence('client', 'evidence-2')]
  raw.freelancer_evidence = [evidence('freelancer', 'evidence-1')]
  raw.evidence_order = ['evidence-1', 'evidence-2']
  raw.evidence_frozen = true
  raw.evidence_root = 'c'.repeat(64)
  raw.client_agreement_accepted = raw.freelancer_agreement_accepted = true
  raw.agreement_status = 'mutually_accepted'
  raw.status = 'evaluated'
  raw.verdict = { verdict_category: 'split', decision_label: 'Partial delivery', confidence_score: 85,
    payment_split: { client: 50, freelancer: 50 }, explanation: 'Half the work was delivered.', recommended_next_step: 'split_payment',
    material_findings: [{ finding: 'Half delivered.', evidence_ids: ['evidence-1'] }] }
  const mapped = mapContractDispute(raw)
  assert.deepEqual(mapped.evidence.map((item) => item.id), raw.evidence_order)
  assert.equal(mapped.evidence[0].provenanceSha256, 'b'.repeat(64))
  assert.equal(mapped.evidence[0].evidenceSha256, 'a'.repeat(64))
  assert.equal(mapped.evidence[0].submittingWallet, freelancer)
  assert.equal(mapped.evidence[0].agreementSha256, raw.agreement_sha256)
  assert.equal(mapped.agreementVersion, AGREEMENT_VERSION)
  assert.equal(mapped.agreementStatus, 'mutually_accepted')
  assert.equal(mapped.evidenceRoot, raw.evidence_root)
  assert.equal(mapped.evidenceFrozen, true)
  assert.deepEqual(mapped.verdict, { outcome: 'split', decisionLabel: 'Partial delivery', confidenceScore: 85,
    paymentSplit: { client: 50, freelancer: 50 }, explanation: ['Half the work was delivered.'], recommendedNextStep: 'split_payment',
    materialFindings: [{ finding: 'Half delivered.', evidenceIds: ['evidence-1'] }] })
})

test('historical reads cannot imply agreement acceptance or invent evidence IDs', () => {
  const mapped = mapContractDispute({ case_id: 'old', agreement: 'Old agreement', client_evidence: [{}] })
  assert.equal(mapped.agreementVersion, 'Unversioned / historical')
  assert.equal(mapped.evidence[0].id, '')
  assert.equal(disputeActions(mapped, client).canSubmit, false)
})

test('address configuration has no fallback and rejects missing, malformed or zero addresses', () => {
  for (const value of [undefined, '', 'bad', '0x' + '00'.repeat(20)]) assert.throws(() => requireContractAddress(value))
  assert.equal(requireContractAddress(client), client)
})
