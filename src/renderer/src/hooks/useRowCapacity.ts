import { useEffect, useState } from 'react'

const MIN_ROWS = 4

// Key breakpoints by window height (px) -> how many table rows fit without
// forcing a scroll. Window height already excludes the OS taskbar (the app
// maximizes to the monitor's work area, see App.tsx enterApp), so no
// separate taskbar adjustment is needed on top of this.
//
// Each tier is derived from: titlebar (52px) + the screen's own top/bottom
// padding (68px) + heading/search-or-breadcrumbs block (~45-100px depending
// on screen) + table header row (~38px) + "Show more" button reserve (56px)
// ≈ 310-350px of fixed chrome, then floor((height - chrome) / ~45px row
// height), with a little safety margin subtracted so slightly different font
// rendering across systems never forces an unwanted scrollbar.
const TIERS: [minHeight: number, rows: number][] = [
  [1450, 22],
  [1300, 19],
  [1150, 16],
  [1000, 13],
  [850, 10],
  [700, 7]
]

function rowsForHeight(height: number): number {
  for (const [minHeight, rows] of TIERS) {
    if (height >= minHeight) return rows
  }
  return MIN_ROWS
}

/** How many table rows fit on screen, based on the window's current height —
 *  recalculated on every resize (e.g. moving the app to a different monitor).
 *  `rowsOffset` — trims this many rows off the tier result, for a screen
 *  whose own header is taller than the ~45-100px the tiers above assume
 *  (e.g. GameDetailScreen's poster+breadcrumbs header vs HistoryScreen's
 *  plain title+search). Trimming rows directly (not a pixel offset fed back
 *  into rowsForHeight) matters regardless of which tier the window height
 *  happens to land in — a pixel offset would only bite right at a tier
 *  boundary. */
export function useRowCapacity(rowsOffset = 0): number {
  function compute(): number {
    return Math.max(MIN_ROWS, rowsForHeight(window.innerHeight) - rowsOffset)
  }

  const [rows, setRows] = useState(compute)

  useEffect(() => {
    function onResize(): void {
      setRows(compute())
    }
    window.addEventListener('resize', onResize)
    onResize()
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsOffset])

  return rows
}
