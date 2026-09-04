/**
 * Drives the running app over the Chrome DevTools protocol.
 *
 * Deliberately not synthetic keystrokes: those go to whatever window has focus,
 * which is a good way to type into someone's chat client. CDP talks to this page
 * and only this page.
 *
 * Usage: launch with --remote-debugging-port=9222, then
 *   node scripts/drive-ui.mjs '<javascript expression>'
 */
const PORT = process.env.KAZE_CDP_PORT ?? '9222'
const expression = process.argv[2]
if (!expression) {
  console.error('usage: node scripts/drive-ui.mjs "<expression>"')
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

const result = await new Promise((resolve, reject) => {
  const id = 1
  const timer = setTimeout(() => reject(new Error('CDP timed out')), 300_000)
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== id) return
    clearTimeout(timer)
    resolve(msg.result)
  })
  ws.send(
    JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }),
  )
})

ws.close()
if (result.exceptionDetails) {
  console.error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  process.exit(1)
}
console.log(JSON.stringify(result.result?.value ?? null, null, 2))
