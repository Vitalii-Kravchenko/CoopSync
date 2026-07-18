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
 *  recalculated on every resize (e.g. moving the app to a different monitor). */
export function useRowCapacity(): number {
  const [rows, setRows] = useState(() => rowsForHeight(window.innerHeight))

  useEffect(() => {
    function onResize(): void {
      setRows(rowsForHeight(window.innerHeight))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return rows
}
