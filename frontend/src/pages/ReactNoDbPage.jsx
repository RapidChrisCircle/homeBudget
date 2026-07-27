export default function ReactNoDbPage() {
  const loadedAt = new Date().toISOString()

  return (
    <section className="card">
      <h2>React No-DB Verification</h2>
      <p>This page is static and does not call any backend or database endpoint.</p>
      <ul>
        <li>Component mount: OK</li>
        <li>Route render: /verify/no-db</li>
        <li>Rendered at: {loadedAt}</li>
      </ul>
    </section>
  )
}
