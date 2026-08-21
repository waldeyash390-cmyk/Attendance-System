export default function PlaceholderPage({ title, blurb }) {
  return (
    <section className="page">
      <h1>{title}</h1>
      <p className="muted">{blurb}</p>
      <div className="card">
        <p className="muted">Coming in a later step.</p>
      </div>
    </section>
  );
}
