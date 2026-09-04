import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Markdown, rendered.
 *
 * The hand-rolled renderer this replaces handled `##` and `-` and nothing else,
 * which was defensible while the only markdown in the app was written by us. It
 * stopped being true twice over: reviews are generated prose full of bold,
 * numbered lists, tables and fenced code, and scenarios are now generated too.
 * Once you no longer control the input, "we control the generality" is not an
 * argument any more.
 *
 * No `rehype-raw`, so raw HTML in the source is inert rather than injected.
 * That matters because everything rendered here came out of a model.
 *
 * Memoized because the review streams: without it every token re-parses the
 * whole document.
 */
export const Markdown = memo(function Markdown({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <div className={`md ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headings inside a side panel are section labels, not page titles;
          // they all render at the same modest weight rather than stepping down
          // from a size the panel has no room for.
          h1: ({ children }) => <h4 className="md__h">{children}</h4>,
          h2: ({ children }) => <h4 className="md__h">{children}</h4>,
          h3: ({ children }) => <h4 className="md__h">{children}</h4>,
          h4: ({ children }) => <h4 className="md__h">{children}</h4>,
          a: ({ children, href }) => (
            // Opened externally by the main process; a review has no business
            // navigating the app away from itself.
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            // Wide content scrolls inside its own box rather than widening the
            // panel and pushing the canvas around.
            <div className="md__tablewrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})
