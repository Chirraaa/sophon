const assert = require('node:assert/strict')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { PassThrough } = require('node:stream')
const { EventEmitter } = require('node:events')
const environment = require('./desktop-review/environment.cjs')
const { app, BrowserWindow, root, failures } = environment
const opened = []
require('electron').shell.openExternal = async (url) => {
  opened.push(url)
}
const dns = require('node:dns/promises')
const lookup = dns.lookup
dns.lookup = async (host, options) =>
  host === 'example.org' ? [{ address: '93.184.215.14', family: 4 }] : lookup(host, options)
const https = require('node:https')
const request = https.request
https.request = (url, options, callback) => {
  if (url.hostname !== 'example.org') return request(url, options, callback)
  const req = new EventEmitter()
  req.end = () =>
    queueMicrotask(() => {
      const res = new PassThrough()
      res.statusCode = 200
      res.headers = { 'content-type': 'text/html; charset=utf-8' }
      callback(res)
      res.end(
        '<title>Test equation page</title><p>Quadratic equation: ax² + bx + c = 0</p><script>window.PWNED=true</script>'
      )
    })
  return req
}
const http = require('node:http')
const original = http.request
http.request = (url, options, callback) => {
  if (!url.pathname.endsWith('/chat/completions')) return original(url, options, callback)
  const req = new EventEmitter()
  req.end = () =>
    queueMicrotask(() => {
      const res = new PassThrough()
      res.statusCode = 200
      res.headers = { 'content-type': 'application/json' }
      callback(res)
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: 'See [equations](https://example.org).' },
              finish_reason: 'stop'
            }
          ]
        })
      )
    })
  return req
}
require(path.join(root, 'out/main/index.js'))
async function wait(check, label) {
  const end = Date.now() + 20000
  while (Date.now() < end) {
    if (await check()) return
    await delay(80)
  }
  throw new Error('Timed out: ' + label)
}
async function main() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'windows')
  const main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  const evaluate = (code) => main.webContents.executeJavaScript(code, true)
  await wait(() => evaluate('!!document.querySelector("textarea")'), 'renderer')
  await evaluate('window.api.send("Show a source link")')
  const click = async (text) =>
    evaluate(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`
    )
  await wait(
    () =>
      evaluate(
        '!!Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="equations")'
      ),
    'link'
  )
  await click('equations')
  await wait(() => evaluate('!!document.querySelector("[role=dialog]")'), 'page chooser')
  assert.equal(opened.length, 0)
  await click('Read in Sophon')
  await wait(
    () =>
      evaluate(
        'document.querySelector("[role=dialog]")?.textContent.includes("Quadratic equation:")'
      ),
    'text reader'
  )
  assert.equal(await evaluate('typeof window.PWNED'), 'undefined')
  assert.equal(await evaluate('window.api.pages.preference()'), null)
  await click('Close')
  await click('equations')
  await wait(
    () => evaluate('!!document.querySelector("[role=dialog] [role=switch]")'),
    'choice again'
  )
  await evaluate('document.querySelector("[role=dialog] [role=switch]").click()')
  await click('Open in browser')
  await wait(() => evaluate('!document.querySelector("[role=dialog]")'), 'browser choice')
  assert.deepEqual(opened, ['https://example.org/'])
  assert.equal(await evaluate('window.api.pages.preference()'), 'browser')
  await click('equations')
  await wait(() => opened.length === 2, 'remembered browser')
  assert.equal(await evaluate('!!document.querySelector("[role=dialog]")'), false)
  const memories = await evaluate('window.api.memory.list()')
  assert.equal(memories.filter((entry) => entry.title === 'Where to open web pages').length, 1)
  await assert.rejects(
    evaluate('window.api.pages.open("file:///C:/secret", "browser", false)'),
    /public HTTPS/
  )
  await assert.rejects(
    evaluate('window.api.pages.open("https://example.org", "shell", false)'),
    /Invalid IPC/
  )
  assert.deepEqual(failures, [])
  console.log(
    'PASS production link rendering, modal chooser, inert reader, browser dispatch, encrypted preference recall, no repeated chooser, URL and IPC rejection'
  )
}
main()
  .then(() => {
    environment.cleanupWorkspace()
    app.quit()
  })
  .catch((error) => {
    console.error(error)
    environment.cleanupWorkspace()
    app.exit(1)
  })
