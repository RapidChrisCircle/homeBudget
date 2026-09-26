import { useSyncExternalStore } from 'react'
import { dismissToast, getToasts, subscribeToToasts } from '../services/toast'

// Mounted once in App.jsx, outside the routed area - see services/toast.ts's
// own docstring for why toast STATE lives there rather than here. aria-live
//="polite" (not "assertive") because nothing shown here is urgent enough to
// interrupt a screen reader mid-sentence - it's a confirmation of something
// that already succeeded, not a new fact the user must act on.
export default function ToastContainer() {
  const toasts = useSyncExternalStore(subscribeToToasts, getToasts)

  if (toasts.length === 0) {
    return null
  }

  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          <span>{toast.message}</span>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss notification"
            onClick={() => dismissToast(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
