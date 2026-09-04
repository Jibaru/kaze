import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Diagram, KazeApi, ReviewEvent, TurnIntent } from '../shared/types'
import type { Locale } from '../shared/i18n'

/** The whole privileged surface the renderer gets. Keep it this short. */
const api: KazeApi = {
  saveDiagram: (diagram: Diagram) => ipcRenderer.invoke('design:save', diagram),
  loadDiagram: () => ipcRenderer.invoke('design:load'),
  snapshotRevision: (diagram: Diagram) => ipcRenderer.invoke('design:snapshot', diagram),
  workspacePath: () => ipcRenderer.invoke('workspace:path'),
  listScenarios: () => ipcRenderer.invoke('scenario:list'),
  getLocale: () => ipcRenderer.invoke('locale:get'),
  setLocale: (locale: Locale) => ipcRenderer.invoke('locale:set', locale),
  review: (diagram: Diagram, intent: TurnIntent, question?: string) =>
    ipcRenderer.invoke('review:run', diagram, intent, question),
  cancelTurn: () => ipcRenderer.invoke('review:cancel'),
  hasVoiceKey: () => ipcRenderer.invoke('voice:has-key'),
  setVoiceKey: (key: string) => ipcRenderer.invoke('voice:set-key', key),
  transcribe: (audio: ArrayBuffer, mimeType: string) => ipcRenderer.invoke('voice:transcribe', audio, mimeType),
  onReviewEvent: (handler: (event: ReviewEvent) => void) => {
    const listener = (_e: IpcRendererEvent, event: ReviewEvent) => handler(event)
    ipcRenderer.on('review:event', listener)
    return () => ipcRenderer.off('review:event', listener)
  },
}

contextBridge.exposeInMainWorld('kaze', api)
