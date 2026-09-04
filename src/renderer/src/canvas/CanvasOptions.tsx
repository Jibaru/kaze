import { Panel } from '@xyflow/react'
import type { BackgroundStyle, EdgeStyle } from '@shared/types'
import { useT } from '../i18n/useLocale'
import type { ViewOptions } from '../diagram-model'

const EDGE_STYLES: EdgeStyle[] = ['bezier', 'smoothstep', 'step', 'straight']
const BACKGROUNDS: BackgroundStyle[] = ['dots', 'grid', 'none']

/**
 * How the canvas is drawn, on the canvas itself rather than in a rail.
 *
 * These are view settings, not part of the design: the reviewer never sees
 * them, and they are saved with the diagram only so the canvas looks the same
 * when you come back to it.
 */
export function CanvasOptions({
  view,
  onChange,
}: {
  view: ViewOptions
  onChange: (next: Partial<ViewOptions>) => void
}) {
  const t = useT()

  return (
    <Panel position="top-right" className="canvasopts">
      <label className="canvasopts__row">
        <span>{t.edgeStyle}</span>
        <select
          value={view.edgeStyle}
          onChange={(e) => onChange({ edgeStyle: e.target.value as EdgeStyle })}
          aria-label={t.edgeStyle}
        >
          {EDGE_STYLES.map((s) => (
            <option key={s} value={s}>
              {t.edgeStyleName[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="canvasopts__row">
        <span>{t.background}</span>
        <select
          value={view.background}
          onChange={(e) => onChange({ background: e.target.value as BackgroundStyle })}
          aria-label={t.background}
        >
          {BACKGROUNDS.map((b) => (
            <option key={b} value={b}>
              {t.backgroundName[b]}
            </option>
          ))}
        </select>
      </label>
    </Panel>
  )
}
