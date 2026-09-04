/// <reference types="vite/client" />
import type { KazeApi } from '@shared/types'

declare global {
  interface Window {
    kaze: KazeApi
  }
}

export {}
