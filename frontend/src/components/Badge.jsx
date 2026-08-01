const TONE_CLASSES = {
  neutral: 'badge-neutral',
  info: 'badge-info',
  success: 'badge-success',
  danger: 'badge-danger',
  warning: 'badge-warning',
}

// Unifies the status/marker convention scattered through the app as plain
// text - auto-categorized, budget overridden, over budget, a recurring
// series' status - into one visual language.
export default function Badge({ tone = 'neutral', title, children }) {
  return (
    <span className={`badge ${TONE_CLASSES[tone] || TONE_CLASSES.neutral}`} title={title}>
      {children}
    </span>
  )
}
