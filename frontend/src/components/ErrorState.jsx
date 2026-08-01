// A page's error message, styled consistently. `label` and `message` are
// separate props (rather than one combined string) so the exact existing
// markup shape - a bold label, a space, then the raw error text - survives:
// <strong>Failed to load accounts:</strong> Network Error
export default function ErrorState({ label, message }) {
  return (
    <p className="state-message state-message-error" role="alert">
      <strong>{label}</strong> {message}
    </p>
  )
}
