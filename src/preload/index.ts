import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ChatAudio, Diagram, KazeApi, ReviewEvent, TurnIntent } from '../shared/types'
import type { Locale } from '../shared/i18n'

/** The whole privileged surface the renderer gets. Keep it this short. */
const api: KazeApi = {
  saveDiagram: (diagram: Diagram) => ipcRenderer.invoke('design:save', diagram),
  loadDiagram: () => ipcRenderer.invoke('design:load'),
  snapshotRevision: (diagram: Diagram) => ipcRenderer.invoke('design:snapshot', diagram),
  workspacePath: () => ipcRenderer.invoke('workspace:path'),
  listScenarios: () => ipcRenderer.invoke('scenario:list'),
  createScenario: (topic: string, difficulty: number) =>
    ipcRenderer.invoke('scenario:create', topic, difficulty),
  revealScenarios: () => ipcRenderer.invoke('scenario:reveal'),
  captureCanvas: (rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('canvas:capture', rect),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:write-text', text),
  cancelScenario: () => ipcRenderer.invoke('scenario:cancel'),
  getLocale: () => ipcRenderer.invoke('locale:get'),
  setLocale: (locale: Locale) => ipcRenderer.invoke('locale:set', locale),
  getFastMode: () => ipcRenderer.invoke('mode:get-fast'),
  setFastMode: (on: boolean) => ipcRenderer.invoke('mode:set-fast', on),
  review: (diagram: Diagram, intent: TurnIntent, question?: string) =>
    ipcRenderer.invoke('review:run', diagram, intent, question),
  cancelTurn: () => ipcRenderer.invoke('review:cancel'),
  newSession: () => ipcRenderer.invoke('attempt:new'),
  proposeFix: (claim: string, fix: string) => ipcRenderer.invoke('review:fix', claim, fix),
  openChat: (diagram: Diagram, speed: number) => ipcRenderer.invoke('chat:open', diagram, speed),
  sayToChat: (said: string, refused: string[], speed: number) =>
    ipcRenderer.invoke('chat:say', said, refused, speed),
  onChatAudio: (handler: (audio: ChatAudio) => void) => {
    const listener = (_e: IpcRendererEvent, audio: ChatAudio) => handler(audio)
    ipcRenderer.on('chat:audio', listener)
    return () => ipcRenderer.off('chat:audio', listener)
  },
  closeChat: () => ipcRenderer.invoke('chat:close'),
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
