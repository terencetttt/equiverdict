import Link from 'next/link'

export default function Home() {
  return (
    <section className="panel hero-panel">
      <div className="heading-row hero-header">
        <div className="hero-copy">
          <p className="eyebrow">Trust & Justice</p>
          <h2>EquiVerdict</h2>
          <p className="hero-tagline">Evidence-led resolution for freelance disputes.</p>
          <p className="hero-message">Submit evidence. Reach a fair outcome.</p>
        </div>
        <div className="hero-actions">
          <Link href="/dashboard">
            <button className="primary">Open dashboard</button>
          </Link>
          <Link href="/dispute/new">
            <button className="secondary">Start a dispute</button>
          </Link>
        </div>
      </div>

      <div className="summary-row">
        <div className="summary-card">
          <p>Fast dispute review</p>
          <strong>5 cases</strong>
        </div>
        <div className="summary-card">
          <p>Verdict confidence</p>
          <strong>79%</strong>
        </div>
        <div className="summary-card">
          <p>Evidence supported</p>
          <strong>12 items</strong>
        </div>
      </div>

      <div className="panel soft-panel intro-card">
        <h3>Structured, transparent case review</h3>
        <p>
          EquiVerdict guides each matter from evidence intake to a clear, reasoned outcome without adding unnecessary complexity.
        </p>
      </div>
    </section>
  )
}
