// Every page's own heading, generalised (T4.1b) from what was the
// Dashboard's own `.dashboard-header` - already exactly this shape (an h2
// plus an optional actions slot), so the Dashboard is the first adopter of
// this rather than a second, near-identical header pattern being invented
// alongside it. `title` and every h2's own text elsewhere in the app stay
// byte-identical - many tests do `getByRole('heading', { name })`.
export default function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="page-header-actions">{children}</div>}
    </div>
  )
}
