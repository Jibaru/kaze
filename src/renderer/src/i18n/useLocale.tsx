import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { dict, DEFAULT_LOCALE, type Dict, type Locale } from '@shared/i18n'

/**
 * The interface language, held in context because nearly every component needs
 * it and threading a prop through the tree would be noise.
 *
 * The choice is persisted by the main process, so it survives a restart and is
 * available where the review prompt and the speech calls are made.
 */
const LocaleContext = createContext<{ locale: Locale; t: Dict; setLocale: (l: Locale) => void }>({
  locale: DEFAULT_LOCALE,
  t: dict(DEFAULT_LOCALE),
  setLocale: () => {},
})

export function LocaleProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, set] = useState<Locale>(initial)

  const value = useMemo(
    () => ({
      locale,
      t: dict(locale),
      setLocale: (next: Locale) => {
        set(next)
        void window.kaze.setLocale(next)
      },
    }),
    [locale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export const useLocale = () => useContext(LocaleContext)

/** Shorthand for the common case of only needing the strings. */
export const useT = (): Dict => useContext(LocaleContext).t
