// The shared markup behind in-place editing on Accounts, Categories and
// Rules: a form that opens directly beneath the row being edited, full
// table width via colSpan, instead of scrolling the user away to a form
// card at the top of the page. Reuses the same disclosure idiom the
// ledger's own Details row already established (aria-expanded/aria-controls
// on the toggle - the caller's own Edit button - and a sibling <tr> for the
// content), rather than inventing a second one.
//
// `colSpan` is a prop, not assumed, because CategoriesPage renders each
// kind group as its own table with its own column count.
//
// This owns only the shared wrapper - the actual fields are the caller's
// `children`, since Accounts/Categories/Rules have entirely different
// forms. The caller's existing startEdit/cancelEdit/handleSubmit and
// payload builders are reused unchanged; only where they render moves.
export default function InlineEditRow({ id, colSpan, onSubmit, onCancel, saving = false, submitLabel = 'Save Changes', children }) {
  return (
    <tr id={id} className="inline-edit-row">
      <td colSpan={colSpan}>
        <form onSubmit={onSubmit}>
          {children}
          <button type="submit" className="button-primary" disabled={saving}>
            {submitLabel}
          </button>
          <button type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        </form>
      </td>
    </tr>
  )
}
