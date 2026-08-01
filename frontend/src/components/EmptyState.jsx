// A page's "nothing here yet" message, styled consistently. `children` is
// for an optional follow-up (e.g. a link to go do the thing that would
// populate this page), matching how a few pages already pair their empty
// message with a next step.
export default function EmptyState({ message, children }) {
  return (
    <div className="state-message">
      <p>{message}</p>
      {children}
    </div>
  )
}
