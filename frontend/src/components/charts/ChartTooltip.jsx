import { useRef, useState } from 'react'

// Shared hover/keyboard-focus tooltip layer for LineChart and BarChart -
// Finding 14: hover was a native SVG <title> only, which is slow to appear
// and unstyled, and never fires on keyboard focus at all. <title> itself is
// left completely alone (still there, still working) - this is additive,
// not a replacement, so nothing about a chart's existing accessible-name/
// hover-text contract changes for any caller.
//
// Position is computed from the HOVERED ELEMENT's own getBoundingClientRect()
// relative to the chart's wrapping container, not from SVG viewBox
// coordinates - the <svg> scales to its rendered size while its internal
// coordinate system stays fixed (CHART_WIDTH/CHART_HEIGHT), so viewBox math
// would misplace the tooltip on any chart not rendered at exactly 1:1.
// Reading the real screen rects sidesteps that entirely.
export function useChartTooltip() {
  const containerRef = useRef(null)
  const [tooltip, setTooltip] = useState(null)

  const showTooltip = (event, content) => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const targetRect = event.currentTarget.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    setTooltip({
      x: targetRect.left + targetRect.width / 2 - containerRect.left,
      y: targetRect.top - containerRect.top,
      content,
    })
  }

  const hideTooltip = () => setTooltip(null)

  return { containerRef, tooltip, showTooltip, hideTooltip }
}

export default function ChartTooltip({ tooltip }) {
  if (!tooltip) {
    return null
  }

  return (
    <div className="chart-tooltip" role="status" style={{ left: tooltip.x, top: tooltip.y }}>
      {tooltip.content}
    </div>
  )
}
