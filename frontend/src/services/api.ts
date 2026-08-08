import axios from "axios";

// FastAPI's own body for a request that reached A server but matched no
// route there at all - not something any endpoint in this app raises on
// purpose (every HTTPException here carries its own specific detail, e.g.
// "Category not found"). Seeing this is the signature of the request
// having landed on the wrong build entirely - most often two API
// containers answering the same hostname behind Docker's round-robin DNS,
// see README.md's "API returns 404 but the page loads" troubleshooting
// note - which is also exactly the case where the browser's Network tab
// is the only ground truth: the SAME page can show a correct response one
// reload and this the next.
const GENERIC_ROUTE_ERRORS = {
    404: "Not Found",
    405: "Method Not Allowed",
};

function isGenericRouteError(status: number | undefined, detail: unknown): boolean {
    // hasOwnProperty, not a plain lookup - a lookup miss and an absent
    // `detail` are both `undefined`, which would otherwise make a 500
    // with no detail at all (a real, separate case handled below) look
    // like it matched a status this map doesn't even cover.
    return (
        typeof detail === "string"
        && status !== undefined
        && Object.prototype.hasOwnProperty.call(GENERIC_ROUTE_ERRORS, status)
        && GENERIC_ROUTE_ERRORS[status as keyof typeof GENERIC_ROUTE_ERRORS] === detail
    );
}

// Every page renders errors via `err?.response?.data?.detail || err?.message`
// (dozens of call sites, all reading the SAME field) - so this is the one
// place that needs to fix "Not Found" reading as content-free, rather than
// editing each of them. Only touches an AMBIGUOUS error: no `detail` at
// all, or FastAPI's generic route-matching body above. A real, specific
// detail from one of our own endpoints is returned completely unchanged,
// which is what keeps every existing call site (and its tests) working
// with no edits - the enriched string still arrives through the exact
// same `detail` field they already read.
export function describeApiError(error: any) {
    const response = error?.response;

    // No response at all - a network failure, CORS block, or the request
    // never left the browser. error.message (axios's own "Network Error")
    // already describes this; there is no server response to enrich.
    if (!response) {
        return Promise.reject(error);
    }

    const { status } = response;
    const detail = response.data?.detail;
    const method = (error.config?.method || "?").toUpperCase();
    const path = error.config?.url || "?";

    if (isGenericRouteError(status, detail)) {
        response.data = {
            ...response.data,
            detail: `${status} ${detail} — ${method} ${path} did not match any route on the API that answered`,
        };
    } else if (!detail) {
        response.data = {
            ...response.data,
            detail: `${status} ${response.statusText || "Error"} — ${method} ${path}`,
        };
    }

    return Promise.reject(error);
}

// --- Detecting more than one API build answering the same hostname --------
//
// Every response - success or failure - carries X-App-Commit
// (backend/app/main.py's add_build_identity_headers), the same commit
// GET /api/version itself reports. Comparing it ACROSS responses, not just
// reading it once, is what catches the case this exists for: Docker
// round-robins DNS across more than one `api` container (README's "API
// returns 404 but the page loads" troubleshooting note), so two requests
// seconds apart can be answered by two different builds with neither
// individually looking wrong.
//
// The first response's own commit becomes the baseline, whatever it is -
// including no header at all, which just means this feature isn't running
// on that build yet. A flag is raised only when a LATER response departs
// from that baseline (a different commit, or the header appearing/
// vanishing where it didn't/did before) - never from the mere absence of
// the header, since a single consistent build that predates this feature
// would otherwise trip a false alarm on every single page load forever.
//
// State lives here, not in a React component, because every page's own
// axios calls pass through this ONE shared instance - a component would
// only ever see the requests it personally triggered. Exposed as a
// subscribe/getSnapshot pair so App.jsx can read it with
// useSyncExternalStore instead of polling.
const UNINITIALIZED = Symbol("uninitialized");
let baselineCommit: string | null | typeof UNINITIALIZED = UNINITIALIZED;
let multipleBuildsDetected = false;
const buildIdentityListeners = new Set<() => void>();

export function subscribeToBuildIdentity(listener: () => void) {
    buildIdentityListeners.add(listener);
    return () => buildIdentityListeners.delete(listener);
}

export function getMultipleBuildsDetected() {
    return multipleBuildsDetected;
}

// Test-only - module-level state otherwise leaks between test cases (and
// test files) that import this module, since it's a singleton exactly like
// `api` itself.
export function _resetBuildIdentityForTests() {
    baselineCommit = UNINITIALIZED;
    multipleBuildsDetected = false;
    buildIdentityListeners.clear();
}

// Exported (not just used internally by the interceptors below) so the
// detection logic itself is directly unit-testable, the same reasoning
// describeApiError above is its own export rather than an inline arrow
// function - a page test mocks the whole `api` module, so nothing wired
// only into the interceptor pipeline would ever actually run under test.
export function recordBuildIdentity(response: any) {
    // response.headers is a plain lowercase-keyed object on both a normal
    // axios response and an error's .response - `?? null` folds a missing
    // header into the same trackable value a response genuinely
    // announcing no commit would have, rather than leaving it undefined
    // and equal to the sentinel by accident.
    const commit = response?.headers?.["x-app-commit"] ?? null;

    if (baselineCommit === UNINITIALIZED) {
        baselineCommit = commit;
        return;
    }

    if (commit !== baselineCommit && !multipleBuildsDetected) {
        multipleBuildsDetected = true;
        for (const listener of buildIdentityListeners) {
            listener();
        }
    }
}

export const api = axios.create({

    baseURL: "/api"

});

api.interceptors.response.use(
    (response) => {
        recordBuildIdentity(response);
        return response;
    },
    (error) => {
        recordBuildIdentity(error?.response);
        return describeApiError(error);
    },
);
