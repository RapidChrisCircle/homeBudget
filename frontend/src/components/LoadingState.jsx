// A page's loading message, styled consistently. Takes the message as a
// prop rather than hardcoding generic text - every page's existing wording
// ("Loading transactions...", "Loading budgets...") stays exactly as it was,
// since several tests assert on it verbatim.
export default function LoadingState({ message }) {
  return (
    <p className="state-message" role="status">
      {message}
    </p>
  )
}
