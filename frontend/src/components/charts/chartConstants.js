// Shared layout constants for LineChart and BarChart, so the two look like
// one visual system rather than two independently-tuned charts.

export const CHART_WIDTH = 640
export const CHART_HEIGHT = 280
export const CHART_MARGIN = { top: 16, right: 16, bottom: 32, left: 56 }
export const CHART_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#4b5563']

export function seriesColor(index) {
  return CHART_COLORS[index % CHART_COLORS.length]
}
