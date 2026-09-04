import { Panel } from '@xyflow/react'
import type { BackgroundStyle, EdgeStyle } from '@shared/types'
import { useT } from '../i18n/useLocale'
import type { ViewOptions } from '../diagram-model'

const EDGE_STYLES: EdgeStyle[] = ['bezier', 'smoothstep', 'step', 'straight']
const BACKGROUNDS: BackgroundStyle[] = ['dots', 'grid', 'none']

const next = <T,>(values: T[], current: T): T => values[(values.indexOf(current) + 1) % values.length]!

/**
 * Each icon draws the thing it selects, rather than standing for it. A line
 * button shows the actual routing you would get, and the background button
 * shows the actual pattern — so the toolbar reads without a legend, and the
 * click that changes the style changes the picture too.
 *
 * Hand-drawn SVG because the project has no icon set beyond the AWS one, and
 * four line shapes and three fills are less code than a dependency.
 */
function EdgeIcon({ style }: { style: EdgeStyle }) {
  const d = {
    bezier: 'M3 17C8 17 8 7 13 7s5 0 8 0',
    smoothstep: 'M3 17h6a3 3 0 0 0 3-3V10a3 3 0 0 1 3-3h6',
    step: 'M3 17h9V7h9',
    straight: 'M3 17 21 7',
  }[style]

  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BackgroundIcon({ style }: { style: BackgroundStyle }) {
  if (style === 'dots') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden focusable="false">
        {[6, 12, 18].map((y) => [6, 12, 18].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />))}
      </svg>
    )
  }
  if (style === 'grid') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden focusable="false">
        <path
          d="M3 9h18M3 15h18M9 3v18M15 3v18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

/**
 * How the canvas is drawn, on the canvas itself rather than in a rail. These
 * are view settings, not part of the design: the reviewer never sees them, and
 * they are saved with the diagram only so it looks the same when you return.
 */
export function CanvasOptions({
  view,
  onChange,
}: {
  view: ViewOptions
  onChange: (next: Partial<ViewOptions>) => void
}) {
  const t = useT()

  // Icon-only buttons, so the name carries the current value and the value it
  // is about to become. Both change on click, which is what a screen reader
  // announces for the button that still has focus.
  const edgeLabel = `${t.edgeStyle}: ${t.edgeStyleName[view.edgeStyle]} — ${t.cycleTo(
    t.edgeStyleName[next(EDGE_STYLES, view.edgeStyle)]!,
  )}`
  const backgroundLabel = `${t.background}: ${t.backgroundName[view.background]} — ${t.cycleTo(
    t.backgroundName[next(BACKGROUNDS, view.background)]!,
  )}`

  return (
    <Panel position="top-right" className="canvasbar">
      <button
        className="canvasbar__btn"
        onClick={() => onChange({ edgeStyle: next(EDGE_STYLES, view.edgeStyle) })}
        aria-label={edgeLabel}
        title={edgeLabel}
      >
        <EdgeIcon style={view.edgeStyle} />
      </button>

      <button
        className="canvasbar__btn"
        onClick={() => onChange({ background: next(BACKGROUNDS, view.background) })}
        aria-label={backgroundLabel}
        title={backgroundLabel}
      >
        <BackgroundIcon style={view.background} />
      </button>
    </Panel>
  )
}
