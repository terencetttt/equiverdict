import type { DisputeCase, EvidenceItem, VerdictResult } from '../lib/cases'

export function AgreementDetails({ record }: { record: DisputeCase }) {
  return <div className="detail-card">
    <h3>Agreement</h3>
    <p><strong>Agreement version:</strong> {record.agreementVersion}</p>
    <p><strong>agreement_sha256:</strong> {record.agreementSha256 || 'Not recorded'}</p>
    <p><strong>Client wallet:</strong> {record.clientWallet}</p>
    <p><strong>Freelancer wallet:</strong> {record.freelancerWallet}</p>
    <p><strong>Client acceptance:</strong> {record.clientAgreementAccepted ? 'Accepted' : 'Awaiting acceptance'}</p>
    <p><strong>Freelancer acceptance:</strong> {record.freelancerAgreementAccepted ? 'Accepted' : 'Awaiting acceptance'}</p>
    <p><strong>Agreement status:</strong> {record.agreementStatus === 'mutually_accepted' ? 'Mutually accepted' : record.agreementStatus}</p>
    <details><summary>Read the exact canonical agreement before accepting</summary><p>{record.agreement}</p></details>
    <p><strong>Evidence freeze state:</strong> {record.evidenceFrozen ? 'Frozen permanently' : 'Open'}</p>
    <p><strong>evidence_root:</strong> {record.evidenceRoot || 'Available after freeze'}</p>
  </div>
}

export function EvidenceDetails({ item }: { item: EvidenceItem }) {
  return <>
    <p><strong>Evidence ID:</strong> {item.id || 'Not recorded'}</p>
    <p><strong>Submitter wallet:</strong> {item.submittingWallet}</p>
    <p><strong>Submitter role:</strong> {item.role}</p>
    <p><strong>content_sha256 (evidence_sha256):</strong> {item.evidenceSha256}</p>
    <p><strong>provenance_sha256:</strong> {item.provenanceSha256 || 'Not recorded'}</p>
    <p><strong>Accepted agreement SHA-256:</strong> {item.agreementSha256 || 'Not recorded'}</p>
    <p><strong>Source type:</strong> {item.type} / HTTPS text or JSON</p>
    <p><strong>URI:</strong> {item.url.startsWith('https://') ? <a href={item.url} target="_blank" rel="noreferrer">{item.url}</a> : item.url || 'Not recorded'}</p>
  </>
}

export function MaterialFindings({ verdict }: { verdict: VerdictResult }) {
  return <div className="reasoning">
    <h3>Material findings</h3>
    {verdict.materialFindings.length ? <ul>{verdict.materialFindings.map((item, index) => <li key={index}>
      <p>{item.finding}</p><p><strong>Cited evidence IDs:</strong> {item.evidenceIds.join(', ')}</p>
    </li>)}</ul> : <p>No material findings recorded.</p>}
  </div>
}
