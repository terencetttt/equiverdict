import Link from 'next/link'

export default function AboutPage() {
  return (
    <section className="panel soft-panel about-panel">
      <div className="heading-row">
        <div>
          <p className="eyebrow">About</p>
          <h2>Why EquiVerdict matters</h2>
        </div>
      </div>
      <p>
        EquiVerdict uses a structured dispute flow and transparent evidence review to make freelance claims easier to resolve. The Trust & Justice visual language keeps the experience readable, calm, and authoritative.
      </p>
      <p>
        The application is built to support case creation, evidence submission, and a reasoned ruling presentation without requiring users to manage complex legal workflows.
      </p>
      <Link href="/dashboard">
        <button className="secondary">Return to dashboard</button>
      </Link>
    </section>
  )
}
