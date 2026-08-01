// Pure value-to-pixel math for the hand-rolled charts in this directory.
// Deliberately has no JSX and touches no DOM, so the degenerate cases that
// actually break a chart - a flat series, a domain spanning zero, an
// all-negative series, no data at all - are unit-testable without rendering
// anything.

// {min, max} for a set of values, padded so a flat series never produces a
// zero-height domain (which would divide by zero downstream in the scale).
// Returns null for zero finite values - the caller's signal to render a
// "not enough data" state instead of an empty axis.
//
// includeZero forces the domain to contain 0 even when no value is near it -
// right for a bar chart (bars should start from a meaningful baseline), but
// wrong for a line chart like balance history, where forcing zero into view
// can flatten a trend that's naturally far from zero (e.g. always deep in
// credit-card debt). Callers choose per chart, not per value.
export function computeDomain(values, { includeZero = false, paddingFraction = 0.08 } = {}) {

  const finite = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v))

  if (finite.length === 0) {
    return null
  }

  let min = Math.min(...finite)
  let max = Math.max(...finite)

  if (includeZero) {
    min = Math.min(min, 0)
    max = Math.max(max, 0)
  }

  if (min === max) {
    // A single repeated value (including a lone data point) has no natural
    // scale of its own - pad by a fraction of its magnitude, or by a fixed
    // amount when the value is exactly zero.
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1
    return { min: min - pad, max: max + pad }
  }

  const pad = (max - min) * paddingFraction
  return { min: min - pad, max: max + pad }
}

// A linear map from a {min, max} domain to a [start, end] pixel range. For an
// SVG y-axis (pixels increase downward), pass range as [heightPx, 0] so a
// larger domain value lands at a smaller pixel - the caller's concern, not
// this function's.
export function linearScale({ domain, range }) {

  const [r0, r1] = range

  if (domain.max === domain.min) {
    // computeDomain never returns a zero-width domain, but a caller could
    // construct one directly (e.g. in a test) - fail soft rather than /0.
    return () => (r0 + r1) / 2
  }

  const span = domain.max - domain.min

  return (value) => r0 + ((value - domain.min) / span) * (r1 - r0)
}

// "Nice" round tick values spanning [min, max], roughly `count` of them -
// the standard nice-numbers algorithm (1/2/5 * 10^n steps), so axis labels
// read as 10/20/30 rather than 9.4/18.8/28.2.
export function niceTicks(min, max, count = 5) {

  if (min === max) {
    return [min]
  }

  const rawStep = niceNumber((max - min) / Math.max(count - 1, 1), true)
  const niceMin = Math.floor(min / rawStep) * rawStep
  const niceMax = Math.ceil(max / rawStep) * rawStep

  const ticks = []
  // Float accumulation drifts (0.1 + 0.2 !== 0.3) - round each tick to kill
  // the dust rather than let it show up as an axis label like "19.999999".
  for (let value = niceMin; value <= niceMax + rawStep / 2; value += rawStep) {
    ticks.push(Math.round(value * 1e6) / 1e6)
  }

  return ticks
}

function niceNumber(value, round) {

  if (value === 0) {
    return 1
  }

  const exponent = Math.floor(Math.log10(Math.abs(value)))
  const fraction = Math.abs(value) / 10 ** exponent

  let niceFraction

  if (round) {
    if (fraction < 1.5) niceFraction = 1
    else if (fraction < 3) niceFraction = 2
    else if (fraction < 7) niceFraction = 5
    else niceFraction = 10
  } else {
    if (fraction <= 1) niceFraction = 1
    else if (fraction <= 2) niceFraction = 2
    else if (fraction <= 5) niceFraction = 5
    else niceFraction = 10
  }

  return niceFraction * 10 ** exponent
}
