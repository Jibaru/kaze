import { useCallback, useEffect, useState } from 'react'

/**
 * Which microphone to use, and remembering the answer.
 *
 * The app used to take the system default, which sounds like the safe choice
 * and is not: on this machine the default input is a virtual device that
 * returns silence. From inside the app that is indistinguishable from a room
 * where nobody is talking — the detector never opens, nothing is ever sent,
 * and there is no error to show. So the device is a choice, and the mode says
 * when the one you chose is delivering nothing.
 *
 * Stored in `localStorage` rather than through the main process, which is where
 * this app's preferences normally live. A device id is not a preference about
 * how you work; it is a fact about this machine's hardware at this moment, it
 * means nothing anywhere else, and it can vanish when a cable is unplugged.
 */

const KEY = 'kaze.audioInput'

/**
 * Labels that mean "this is not a microphone".
 *
 * A heuristic, and only ever used to pick the *first* default — the choice is
 * yours after that and it is remembered. It exists because the alternative
 * default is alphabetical luck, and on this machine luck picked a virtual
 * device that returns silence, which the app then presented as a quiet room.
 *
 * Matched case-insensitively against both the English and Spanish names,
 * because Windows localizes them.
 */
const NOT_A_MICROPHONE =
  /virtual|loopback|stereo mix|mezcla est|cable|voicemeeter|vb-audio|what u hear|mix estéreo/i

/** The first thing that looks like a real microphone, else the first thing. */
const preferred = (found: AudioInput[]): string =>
  (found.find((d) => !NOT_A_MICROPHONE.test(d.label)) ?? found[0])?.deviceId ?? ''

export interface AudioInput {
  deviceId: string
  label: string
}

const read = (): string => {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    // Storage can be unavailable outright. A forgotten choice is a small loss.
    return ''
  }
}

export function useAudioInputs(enabled: boolean) {
  const [inputs, setInputs] = useState<AudioInput[]>([])
  const [deviceId, setDeviceId] = useState(read)

  const refresh = useCallback(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const found = devices
      .filter((d) => d.kind === 'audioinput')
      // "Default" and "Communications" are aliases for one of the others, and
      // offering the same microphone three times under different names is how
      // you end up picking the wrong one.
      .filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId.slice(0, 8) }))
    setInputs(found)
    // A remembered device that is no longer plugged in must not be sent to
    // `getUserMedia` as `exact`, or the mode opens with an error every time.
    setDeviceId((current) => (found.some((d) => d.deviceId === current) ? current : preferred(found)))
  }, [])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [enabled, refresh])

  const choose = useCallback((id: string) => {
    setDeviceId(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Not worth failing over; it just will not be remembered.
    }
  }, [])

  return { inputs, deviceId, choose }
}
