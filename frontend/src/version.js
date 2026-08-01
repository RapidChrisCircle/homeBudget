/* global __APP_VERSION__, __GIT_SHA__ */

// __APP_VERSION__ / __GIT_SHA__ are literal build-time substitutions from
// vite.config.js's `define` block (sourced from the APP_VERSION / GIT_SHA
// env vars the Docker build sets - see backend/app/version.py's docstring
// for the full resolution story on the API side, which this mirrors).
//
// Written as functions, not top-level consts, so a test can stub the global
// and call fresh rather than needing to reset/re-import the module. The
// `typeof` guard matters for real: outside a Vite-processed build (e.g. this
// file imported by a tool that doesn't apply `define`) the bare identifier
// would throw a ReferenceError on access without it.
export function getAppVersion() {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
}

export function getGitSha() {
  return typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : 'unknown'
}
