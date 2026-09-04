/**
 * Drives the running app over the Chrome DevTools protocol.
 *
 * Deliberately not synthetic keystrokes: those go to whatever window has focus,
 * which is a good way to type into someone's chat client. CDP talks to this page
 * and only this page.
 *
 * Usage: launch with --remote-debugging-port=9222, then
 *   node scripts/drive-ui.mjs '<javascript expression>'
 *   node scripts/drive-ui.mjs --key Escape
 *   node scripts/drive-ui.mjs --drag <x1> <y1> <x2> <y2>
 *
 * `--key` sends a *trusted* key event through CDP. Synthetic KeyboardEvents
 * dispatched from page script cannot trigger user-agent behaviour — Escape
 * closing a <dialog>, for one — so testing that with dispatchEvent silently
 * reports a failure that isn't there. Unlike SendKeys this is scoped to this
 * page, so it cannot land in another window.
 */
const PORT = process.env.KAZE_CDP_PORT ?? '9222'
const keyMode = process.argv[2] === '--key'
const dragMode = process.argv[2] === '--drag'
const expression = keyMode || dragMode ? null : process.argv[2]
const key = keyMode ? process.argv[3] : null
const drag = dragMode ? process.argv.slice(3, 7).map(Number) : null
if (!expression && !key && !drag) {
  console.error('usage: node scripts/drive-ui.mjs "<expression>" | --key <Key> | --drag x1 y1 x2 y2')
  process.exit(2)
}

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('no debuggable page; is the app running with --remote-debugging-port?')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((ok, fail) => {
  ws.addEventListener('open', ok, { once: true })
  ws.addEventListener('error', fail, { once: true })
})

const send = (id, method, params) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP timed out')), 300_000)
    const onMessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== id) return
      clearTimeout(timer)
      ws.removeEventListener('message', onMessage)
      resolve(msg.result)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })

let result
if (dragMode) {
  // Trusted mouse events. A drag built from synthetic MouseEvents does not
  // drive a real drag-and-drop; this does, and it still cannot leave the page.
  const [x1, y1, x2, y2] = drag
  const base = { button: 'left', buttons: 1, clickCount: 1 }
  await send(1, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1, buttons: 0 })
  await send(2, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, ...base })
  // Several steps: a single jump can be read as a click rather than a drag.
  for (let i = 1; i <= 8; i++) {
    await send(2 + i, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x1 + ((x2 - x1) * i) / 8,
      y: y1 + ((y2 - y1) * i) / 8,
      buttons: 1,
    })
  }
  await send(20, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, ...base })
  result = { result: { value: `dragged ${x1},${y1} -> ${x2},${y2}` } }
} else if (keyMode) {
  // A trusted key event still needs the native key code, or the page sees a
  // keypress the browser itself does not act on.
  const CODES = { Escape: 27, Backspace: 8, Delete: 46, Enter: 13, Tab: 9 }
  const params = { key, code: key, windowsVirtualKeyCode: CODES[key] ?? 0, nativeVirtualKeyCode: CODES[key] ?? 0 }
  await send(1, 'Input.dispatchKeyEvent', { type: 'keyDown', ...params })
  await send(2, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params })
  result = { result: { value: `sent ${key}` } }
} else {
  result = await send(1, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
}

ws.close()
if (result.exceptionDetails) {
  console.error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  process.exit(1)
}
console.log(JSON.stringify(result.result?.value ?? null, null, 2))
