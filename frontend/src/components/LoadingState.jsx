// A page's loading message, styled consistently. Takes the message as a
// prop rather than hardcoding generic text - every page's existing wording
// ("Loading transactions...", "Loading budgets...") stays exactly as it was,
// since several tests assert on it verbatim.
//
// `rows` (optional) swaps the plain text line for a skeleton of that many
// shimmering row-shaped bars instead - for the tables that would otherwise
// collapse to one line of text and jump the whole page on every fetch (see
// App.css's .skeleton-row). The accessible announcement doesn't change:
// `message` is still there, in a role="status" region, just visually
// hidden rather than the only thing on screen - a screen reader user still
// hears "Loading transactions...", a sighted user sees the table's own
// shape instead of empty space.
export default function LoadingState({ message, rows = 0 }) {
  if (rows > 0) {
    return (
      <div className="skeleton-loading" role="status">
        <span className="visually-hidden">{message}</span>
        <div className="skeleton-rows" aria-hidden="true">
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="skeleton-row" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <p className="state-message" role="status">
      {message}
    </p>
  )
}
