/// <reference types="vite/client" />
import type { KazeApi } from '@shared/types'

declare global {
  interface Window {
    kaze: KazeApi
  }
}

// React 18's JSX types predate the popover API, which Chromium has shipped
// since 114. Declaring them here beats casting at every call site.
declare module 'react' {
  interface HTMLAttributes<T> {
    popover?: 'auto' | 'manual'
  }
  interface ButtonHTMLAttributes<T> {
    popoverTarget?: string
    popoverTargetAction?: 'toggle' | 'show' | 'hide'
  }
}

export {}
