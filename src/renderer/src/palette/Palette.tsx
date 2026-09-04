import { useMemo, useState } from 'react'
import { CATEGORIES, searchServices, type ServiceSpec } from '@shared/services'
import { getServiceIcon } from '../service-icons'
import { useT } from '../i18n/useLocale'

/**
 * Search matches synonyms, so "redis" finds ElastiCache and "queue" finds SQS.
 * You think in problems, not in AWS product names.
 */
export function Palette({ onAdd }: { onAdd: (spec: ServiceSpec) => void }) {
  const t = useT()
  const [query, setQuery] = useState('')

  const grouped = useMemo(() => {
    const hits = searchServices(query)
    return CATEGORIES.map((c) => ({ category: c, items: hits.filter((s) => s.category === c) })).filter(
      (g) => g.items.length > 0,
    )
  }, [query])

  return (
    <div className="palette">
      <input
        className="palette__search"
        aria-label={t.searchServices}
        placeholder={t.searchPlaceholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
      />
      <div className="palette__list">
        {grouped.map(({ category, items }) => (
          <section key={category}>
            <h3 className="palette__category">{t.category[category] ?? category}</h3>
            {items.map((spec) => {
              const Icon = getServiceIcon(spec.id)
              return (
              <button
                key={spec.id}
                className="palette__item"
                onClick={() => onAdd(spec)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/kaze-service', spec.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                title={t.addService(spec.name)}
              >
                {Icon && <Icon className="palette__icon" aria-hidden />}
                <span>{spec.name}</span>
              </button>
              )
            })}
          </section>
        ))}
        {grouped.length === 0 && <p className="palette__empty">{t.noMatches(query)}</p>}
      </div>
    </div>
  )
}
