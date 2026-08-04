// Shared layout constants for LineChart and BarChart, so the two look like
// one visual system rather than two independently-tuned charts.

export const CHART_WIDTH = 640
export const CHART_HEIGHT = 280
export const CHART_MARGIN = { top: 16, right: 16, bottom: 32, left: 56 }

// References to the --series-1..7 custom properties defined in index.css,
// not literal hex values - so a chart's series colours resolve through
// whichever theme block is active (light default, the no-JS
// prefers-color-scheme fallback, or an explicit Light/Dark pick) exactly
// like every other themed colour in the app, with zero theme-awareness
// needed here or in the chart components that call seriesColor(). Each set
// of seven is independently validated for colourblind separation, a
// chroma floor and contrast against its own surface - see index.css's
// comment above --series-1 for the exact command. Never cycled past 7 -
// see dataviz's anti-patterns on generating a 9th categorical hue.
export const CHART_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
]

export function seriesColor(index) {
  return CHART_COLORS[index % CHART_COLORS.length]
}
