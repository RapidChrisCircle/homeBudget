import { Component } from 'react'

// A class component because React error boundaries have no hooks
// equivalent - getDerivedStateFromError/componentDidCatch only exist on
// class components.
//
// Wraps <Routes> in App.jsx, not the whole <main> - the header, nav and
// footer sit OUTSIDE this boundary, so a page-level render crash still
// leaves the header, version badge, theme select and nav fully usable.
// Reload is the only recovery action offered, deliberately: resetting local
// state and re-rendering the SAME crashed route would very likely throw
// again immediately, since nothing about the underlying bug has changed -
// a reload is the one action that's actually guaranteed to help, and the
// nav bar (still visible above this) is the other real way out, to a
// DIFFERENT route that isn't the one that crashed.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Unhandled error rendering the page:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <section className="page">
          <h2>Something went wrong</h2>
          <p className="state-message state-message-error" role="alert">
            This page hit an unexpected error and couldn&apos;t render.
            {this.state.error?.message && ` (${this.state.error.message})`}
          </p>
          <button type="button" className="button-primary" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </section>
      )
    }

    return this.props.children
  }
}
