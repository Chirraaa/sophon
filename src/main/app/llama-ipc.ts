import { app, dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { dirname, join } from 'path'
import type { SecureIpc } from '../security/ipc'
import { nativeConsent } from '../security/native-consent'
import { ownedJson } from '../security/owned-http'
import { getSettings, settingsRecovery, updateSettings } from '../settings'
import {
  LlamaServer,
  assertGgufModel,
  assertLlamaExecutable,
  probeLlamaCapabilities,
  readLlamaConfig,
  writeLlamaConfig,
  type LlamaConfig
} from '../llm/llama-server'
import { sanitizeLlamaOptions, type LlamaOptions } from '../../shared/llama-server'
import { broadcast, type Desktop } from './desktop'

const EXTERNAL_ENDPOINT = 'http://127.0.0.1:1234/v1'

export interface LlamaView {
  config: LlamaConfig
  status: ReturnType<LlamaServer['status']>
  // Options the running server was started with, so the screen can offer a restart.
  applied: LlamaOptions | null
}

let config: LlamaConfig | null = null
let applied: LlamaOptions | null = null
const configFile = (): string => join(app.getPath('userData'), 'llama-server.json')
const current = (): LlamaConfig => (config ??= readLlamaConfig(configFile()))
const save = (next: LlamaConfig): void => {
  writeLlamaConfig(configFile(), next)
  config = next
}

const server = new LlamaServer(
  async (port, pid, signal) => (await ownedJson(port, '/health', pid, signal)).status === 'ok',
  (status) => {
    if (status.state !== 'running' && status.state !== 'starting') applied = null
    broadcast('llama:status', status)
  }
)

const view = (): LlamaView => ({ config: current(), status: server.status(), applied })

// Starting the server is the user's explicit choice, so Sophon follows it: it talks to the port it
// started, and sizes its own context budget to what the server was given.
function followServer(options: LlamaOptions, port: number): void {
  updateSettings({
    model: {
      provider: 'local',
      endpoint: `http://127.0.0.1:${port}/v1`,
      modelId: '',
      contextWindow: options.contextSize,
      thinking: options.thinking
    }
  })
}

async function startServer(): Promise<LlamaView> {
  if (settingsRecovery().required) throw new Error('Review recovered settings first.')
  const config = current()
  if (!config.enabled) throw new Error('Choose llama.cpp as the runtime first.')
  const status = await server.start(config)
  applied = { ...config.options }
  followServer(config.options, status.port ?? config.options.port)
  return view()
}

// Called once the app is ready: bring the model up if the user asked for that.
export function autoStartLlama(): void {
  const config = current()
  if (!config.enabled || !config.options.autoStart || settingsRecovery().required) return
  void startServer().catch(() => {
    /* The failure is already in the status shown on the Model screen. */
  })
}

export function registerLlamaIpc(ipcMain: SecureIpc, desktop: Desktop): void {
  const owner = (event: IpcMainInvokeEvent): BrowserWindow => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || !desktop.owns(event.sender) || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Unknown app window.')
    return win
  }
  app.once('before-quit', () => {
    void server.stop()
  })

  ipcMain.handle('llama:get', view)

  ipcMain.handle('llama:set-enabled', async (_event, enabled: boolean) => {
    const config = current()
    if (enabled === config.enabled) return view()
    if (!enabled) {
      await server.stop()
      // Leave Sophon pointing at the usual external server instead of a port nothing listens on.
      if (new URL(getSettings().model.endpoint).port === String(config.options.port))
        updateSettings({ model: { endpoint: EXTERNAL_ENDPOINT, modelId: '' } })
    }
    save({ ...config, enabled })
    return view()
  })

  ipcMain.handle('llama:pick-executable', async (event) => {
    const win = owner(event)
    if (settingsRecovery().required) throw new Error('Review recovered settings first.')
    const config = current()
    const choice = await desktop.keepOpen(() =>
      dialog.showOpenDialog(win, {
        title: 'Choose llama-server',
        buttonLabel: 'Use this program',
        properties: ['openFile'],
        filters: [{ name: 'llama-server', extensions: ['exe'] }],
        defaultPath: config.executable ? dirname(config.executable) : undefined
      })
    )
    if (choice.canceled || !choice.filePaths[0]) return null
    const executable = choice.filePaths[0]
    assertLlamaExecutable(executable)
    if (
      !(await nativeConsent(
        'Run this program for your local model?',
        `Program: ${executable}\n\nSophon will start it when you start the local model, and stop it when you stop the model or quit. It runs with your Windows account's permissions and is told to listen only on 127.0.0.1.\n\nSophon will also run it once now with --help to find out which options it supports.`
      ))
    )
      return null
    const caps = await probeLlamaCapabilities(executable)
    await server.stop()
    save({ ...config, executable, caps })
    return view()
  })

  ipcMain.handle('llama:pick-model', async (event) => {
    const win = owner(event)
    const config = current()
    const choice = await desktop.keepOpen(() =>
      dialog.showOpenDialog(win, {
        title: 'Choose a model',
        buttonLabel: 'Use this model',
        properties: ['openFile'],
        filters: [{ name: 'GGUF model', extensions: ['gguf'] }],
        defaultPath: config.modelPath ? dirname(config.modelPath) : undefined
      })
    )
    if (choice.canceled || !choice.filePaths[0]) return null
    assertGgufModel(choice.filePaths[0])
    save({ ...config, modelPath: choice.filePaths[0] })
    return view()
  })

  ipcMain.handle('llama:options', (_event, patch: Partial<LlamaOptions>) => {
    const config = current()
    const options = sanitizeLlamaOptions({ ...config.options, ...patch }, config.options)
    save({ ...config, options })
    return view()
  })

  ipcMain.handle('llama:start', startServer)

  ipcMain.handle('llama:stop', async () => {
    await server.stop()
    return view()
  })
}
