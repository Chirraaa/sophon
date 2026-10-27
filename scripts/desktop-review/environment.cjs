const { app, BrowserWindow, globalShortcut, dialog, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { showcase, widget } = require('./visual-fixtures.cjs')
const visualRefusal = require('./visual-refusal.cjs')
const formatting = require('./formatting-fixtures.cjs')
const root = path.resolve(__dirname, '../..')
const output = path.join(root, '.cache', 'desktop-review')
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(output, 'profile-'))

const workspace = fs.mkdtempSync(path.join(require('node:os').homedir(), 'sophon-workspace-test-'))
fs.writeFileSync(path.join(workspace, 'notes.txt'), 'The project color is silver.')
fs.copyFileSync(path.join(root, 'resources/icon.png'), path.join(workspace, 'sample.png'))
fs.writeFileSync(path.join(profile, 'outside.txt'), 'Outside the workspace')
app.setPath('userData', profile)
app.setAppPath(root)
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
fs.writeFileSync(
  path.join(profile, 'settings.json'),
  JSON.stringify({
    model: { endpoint: 'http://127.0.0.1:19091/v1', modelId: 'review-model' },
    files: { workspace },
    voice: {
      mode: 'toggle',
      serverPath: path.join(workspace, 'notes.txt'),
      modelPath: path.join(workspace, 'notes.txt')
    }
  })
)
const shortcuts = new Map()
globalShortcut.register = (key, callback) => {
  shortcuts.set(key, callback)
  return true
}
globalShortcut.unregister = (key) => shortcuts.delete(key)
globalShortcut.unregisterAll = () => shortcuts.clear()
dialog.showOpenDialog = async () => ({
  canceled: false,
  filePaths: [path.join(workspace, 'sample.png'), path.join(workspace, 'notes.txt')]
})
dialog.showMessageBox = async () => ({ response: 1 })

require('../security/consent-fixture.cjs')(
  app,
  async () => (await dialog.showMessageBox(null, {})).response === 1
)
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(profile, 'saved.png') })
let lastRequest
let requestCount = 0
const originalFetch = global.fetch
global.fetch = async (url, options) => {
  if (!String(url).startsWith('http://127.0.0.1:19091/')) return originalFetch(url, options)
  if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'review-model' }] })
  lastRequest = JSON.parse(options.body)
  requestCount++
  const messages = lastRequest.messages
  const requested = messages.findLastIndex(
    (message) =>
      message.role === 'user' &&
      typeof message.content === 'string' &&
      message.content.startsWith('tool:')
  )
  let reply = { role: 'assistant', content: 'A quiet silver workspace.' }
  let finishReason = 'stop'
  if (
    messages.at(-1).role === 'system' &&
    messages.at(-1).content.includes('incorrectly denied an available renderer capability')
  ) {
    reply.content = '```html\n' + widget + '\n```'
  } else if (String(messages.at(-1).content).includes('questions regression')) {
    reply = {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'clarify-lesson',
          type: 'function',
          function: {
            name: 'ask_questions',
            arguments: JSON.stringify({
              questions: [
                {
                  title: 'What kind of help do you need with this lesson?',
                  options: [
                    'Explain the concepts simply',
                    'Work through practice problems',
                    'Prepare for an exam or quiz',
                    'Summarize the key points'
                  ]
                },
                {
                  title: 'What is your current level?',
                  options: ['Beginner', 'High school', 'University']
                },
                {
                  title: 'Which topic feels hardest?',
                  options: ['Wave functions', 'Uncertainty principle', 'Schrödinger equation']
                }
              ]
            })
          }
        }
      ]
    }
    finishReason = 'tool_calls'
  } else if (String(messages.at(-1).content).includes('formatting regression')) {
    reply.content = formatting.showcase
  } else if (String(messages.at(-1).content).includes('capability regression')) {
    reply.content = visualRefusal
  } else if (String(messages.at(-1).content).includes('interactive visual showcase')) {
    reply.content = showcase
  } else if (String(messages.at(-1).content).includes('broken visual example')) {
    reply.content =
      '```html\n<!doctype html><html><head><title>Error example</title></head><body><script>throw new Error("intentional-visual-test")</script></body></html>\n```'
  } else if (String(messages.at(-1).content).includes('truncated visual example')) {
    reply.content =
      '```html\n<!doctype html><html><head><title>Incomplete</title></head><body><h1>Cut off'
    finishReason = 'length'
  } else if (requested >= 0 && requested === messages.length - 1) {
    const [, name, args] = /^tool:([^|]+)\|(.+)$/.exec(messages[requested].content)
    reply = {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'review-' + Date.now(), type: 'function', function: { name, arguments: args } }
      ]
    }
  } else if (
    requested >= 0 &&
    messages.slice(requested).some((message) => message.role === 'tool') &&
    (messages.at(-1).role === 'tool' || Array.isArray(messages.at(-1).content))
  ) {
    reply.content = 'File operation complete.'
  } else if (JSON.stringify(messages.at(-1).content).includes('alpha')) {
    reply.content = 'A simple flow.\n\n```mermaid\nflowchart LR\n  A[Question] --> B[Answer]\n```'
  }
  return Response.json({ choices: [{ message: reply, finish_reason: finishReason }] })
}
const failures = []
app.on('web-contents-created', (_, contents) => {
  contents.on('render-process-gone', (_, details) => failures.push(details))
  contents.on('console-message', (details) => {
    if (
      details.level === 'error' &&
      !details.message.includes('Content Security Policy') &&
      !details.message.includes('intentional-visual-test')
    )
      failures.push(details.message)
  })
})

module.exports = {
  app,
  BrowserWindow,
  screen,
  root,
  profile,
  workspace,
  output,
  shortcuts,
  failures,
  cleanupWorkspace: () => {
    const home = require('node:os').homedir()
    assertScratch(workspace, home)
    fs.rmSync(workspace, { recursive: true, force: true })
  },
  getRequest: () => lastRequest,
  getRequestCount: () => requestCount
}
function assertScratch(directory, home) {
  if (
    path.dirname(path.resolve(directory)) !== path.resolve(home) ||
    !/^sophon-workspace-test-[A-Za-z0-9]+$/.test(path.basename(directory)) ||
    fs.realpathSync(directory).toLowerCase() !== path.resolve(directory).toLowerCase()
  )
    throw new Error('Refusing cleanup outside generated scratch directory')
}

const http = require('node:http')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const originalRequest = http.request
http.request = (url, options, callback) => {
  if (url.origin !== 'http://127.0.0.1:19091') return originalRequest(url, options, callback)
  const request = new EventEmitter()
  request.end = (body) => {
    queueMicrotask(async () => {
      if (options.signal?.aborted) {
        request.emit('error', new Error('Aborted'))
        return
      }
      const result = await global.fetch(url.href, { body })
      const response = new PassThrough()
      response.statusCode = result.status
      response.headers = { 'content-type': 'application/json' }
      callback(response)
      response.end(Buffer.from(await result.arrayBuffer()))
    })
  }
  request.destroy = (error) => {
    if (error) request.emit('error', error)
    return request
  }
  return request
}
