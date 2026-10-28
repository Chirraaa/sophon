import { BrowserWindow, clipboard, dialog, type IpcMainInvokeEvent } from 'electron'
import { secureIpc } from '../security/ipc'
import type { UpdateService } from '../services/updates'
import { clearSecurityEvents } from '../security/audit'
import { nativeConsent, setConsentOwner } from '../security/native-consent'
import { readConsent, resolveConsent } from '../security/consent-window'
import { settingsRecovery } from '../settings'
import { validateWorkspaceRoot, synchronizedWorkspace } from '../security/workspace-policy'
import { createHash } from 'crypto'
import { stopRun } from '../security/run-manager'
import { hasSearchKey, setSearchKey } from '../security/credentials'
import { hasModelKey, setModelKey } from '../security/model-credentials'
import {
  chatgptStatus,
  signInChatgpt,
  cancelChatgptSignIn,
  selectChatgptAccount,
  signOutChatgpt,
  acknowledgeChatgptWelcome,
  openChatgptUsage
} from '../security/chatgpt-auth'
import {
  microsoftStatus,
  setMicrosoftClientId,
  signInMicrosoft,
  cancelMicrosoftSignIn,
  selectMicrosoftAccount,
  removeMicrosoftAccount
} from '../security/microsoft-auth'
import { getLlmStatus, listModels, listModelChoices, getModelInfo, getDefaultPrompt } from '../llm'
import {
  clear,
  createChat,
  selectChat,
  renameChat,
  moveChat,
  createChatCategory,
  renameChatCategory,
  deleteChatCategory,
  deleteChat,
  send,
  rerun,
  setGithubContext,
  snapshot
} from '../chat/session'
import { chatPage, actionDetails } from '../chat/session'
import { resolveApproval } from '../permissions'
import { getSettings, updateSettings } from '../settings'
import { TOOL_INFO } from '../tools/registry'
import { captureScreen } from '../tools/screen'
import {
  pickAttachments,
  previewAttachment,
  saveAttachment,
  storeImage
} from '../services/attachments'
import { hardwareInfo } from '../services/hardware'
import { broadcast, type Desktop } from './desktop'
import type { Shortcuts } from './shortcuts'
import { registerSettingsIpc } from './settings-ipc'
import { registerPluginsIpc } from '../plugins/ipc'
import { githubCheckoutAction, githubCheckoutStatus } from '../plugins/github-checkout'
import type { GithubCheckoutAction } from '../../shared/github-history'
import { listMemories, saveMemory, deleteMemory } from '../memory/store'
import { inspectHarness, readHarness } from '../harness/store'
import { openPage, pagePreference } from '../services/pages'
import {
  createVisual,
  releaseVisual,
  saveVisual,
  createImageVisual,
  createDiagram
} from '../services/visuals'
export function registerIpc(desktop: Desktop, shortcuts: Shortcuts, updates: UpdateService): void {
  setConsentOwner(() =>
    desktop.main?.isVisible()
      ? desktop.main
      : desktop.compact?.isVisible()
        ? desktop.compact
        : desktop.main
  )
  const ipcMain = secureIpc((contents) => desktop.owns(contents))
  ipcMain.handle('updates:get', updates.get)
  ipcMain.handle('updates:check', updates.check)
  ipcMain.handle('updates:download', updates.download)
  ipcMain.handle('updates:install', updates.install)
  ipcMain.handle('updates:acknowledge', updates.acknowledge)
  registerPluginsIpc(ipcMain, (context, snapshot) =>
    broadcast('github:history-changed', { context, snapshot })
  )
  ipcMain.handle('github:checkout', (event, context: GithubContext, action: GithubCheckoutAction) =>
    desktop.keepOpen(async () => {
      if (action === 'status') return githubCheckoutStatus(context)
      if (snapshot().busy)
        throw new Error('Finish or stop the current task before updating a checkout.')
      if (settingsRecovery().required) throw new Error('Review recovered settings first.')
      if (action === 'link') {
        const choice = await dialog.showOpenDialog(owner(event), {
          title: `Link ${context.repository} checkout`,
          properties: ['openDirectory'],
          buttonLabel: 'Link checkout'
        })
        if (choice.canceled) return githubCheckoutStatus(context)
        const checkout = await githubCheckoutAction(context, action, choice.filePaths[0])
        broadcast('github:checkout-changed', { context, checkout })
        return checkout
      }
      const checkout = await githubCheckoutAction(context, action)
      broadcast('github:checkout-changed', { context, checkout })
      return checkout
    })
  )
  ipcMain.handle('pages:preference', () => pagePreference())
  ipcMain.handle(
    'pages:open',
    (_event, url: string, destination: PageDestination, remember: boolean) => {
      if (remember && snapshot().busy)
        throw new Error('Wait for the task to finish before saving a preference.')
      return openPage(url, destination, remember)
    }
  )
  ipcMain.handle('consent:read', (event) => readConsent(event.sender))
  ipcMain.handle('consent:resolve', (event, id: string, allow: boolean) =>
    resolveConsent(event.sender, id, allow)
  )
  const voice = desktop.voice
  ipcMain.handle('memory:list', listMemories)
  ipcMain.handle('harness:list', () => {
    return inspectHarness()
  })
  ipcMain.handle('harness:read', (_event, category: string, name: string) => {
    return readHarness(category, name)
  })
  ipcMain.handle('memory:save', (_event, draft: MemoryDraft) => {
    const session = snapshot()
    if (session.busy) throw new Error('Stop the current task before editing memories.')
    return saveMemory(draft, getSettings().files.workspace, session.chatId)
  })
  ipcMain.handle('memory:delete', (_event, id: string) => {
    if (snapshot().busy) throw new Error('Stop the current task before deleting memories.')
    return deleteMemory(id)
  })
  ipcMain.handle('clipboard:write-text', (_event, text: string) => clipboard.writeText(text))
  ipcMain.handle('text:edit', (event, action: 'cut' | 'paste' | 'selectAll' | 'undo' | 'redo') => {
    event.sender[action]()
  })
  ipcMain.handle('visuals:image', (event, dataUrl: string) => {
    owner(event)
    return createImageVisual(event.sender, dataUrl)
  })
  ipcMain.handle('visuals:diagram', (event, source: string) => {
    owner(event)
    return createDiagram(event.sender, source)
  })
  ipcMain.handle('privacy:clear-security-events', clearSecurityEvents)
  ipcMain.handle('agent:stop', () => {
    stopRun()
    voice.cancel()
  })
  ipcMain.handle('research:has-key', hasSearchKey)
  ipcMain.handle('chatgpt:status', chatgptStatus)
  ipcMain.handle('chatgpt:sign-in', (_event, accountId?: string) => {
    if (getSettings().model.provider !== 'chatgpt')
      throw new Error('Select ChatGPT subscription in Settings > Model first.')
    return signInChatgpt(accountId)
  })
  ipcMain.handle('chatgpt:cancel', cancelChatgptSignIn)
  ipcMain.handle('chatgpt:select', (_event, accountId: string) => selectChatgptAccount(accountId))
  ipcMain.handle('chatgpt:sign-out', signOutChatgpt)
  ipcMain.handle('chatgpt:welcome', acknowledgeChatgptWelcome)
  ipcMain.handle('chatgpt:usage', openChatgptUsage)
  ipcMain.handle('microsoft:status', microsoftStatus)
  ipcMain.handle('microsoft:set-client', (_event, clientId: string) =>
    setMicrosoftClientId(clientId)
  )
  ipcMain.handle('microsoft:sign-in', (_event, accountId?: string) => signInMicrosoft(accountId))
  ipcMain.handle('microsoft:cancel', cancelMicrosoftSignIn)
  ipcMain.handle('microsoft:select', (_event, accountId: string) =>
    selectMicrosoftAccount(accountId)
  )
  ipcMain.handle('microsoft:remove', (_event, accountId: string) =>
    removeMicrosoftAccount(accountId)
  )
  ipcMain.handle('model:has-key', (_event, provider: ModelProvider, endpoint: string) =>
    hasModelKey(provider, endpoint)
  )
  ipcMain.handle(
    'model:set-key',
    async (_event, provider: ModelProvider, endpoint: string, key: string) => {
      const settings = getSettings().model
      if (settings.provider !== provider || settings.endpoint !== endpoint)
        throw new Error('Model connection changed. Reopen Settings and try again.')
      if (
        !(await nativeConsent(
          key ? 'Save model credential?' : 'Delete model credential?',
          JSON.stringify(
            {
              provider,
              endpoint,
              keyFingerprint: key ? createHash('sha256').update(key).digest('hex') : 'delete'
            },
            null,
            2
          )
        ))
      )
        throw new Error('Credential change cancelled.')
      const current = getSettings().model
      if (current.provider !== provider || current.endpoint !== endpoint)
        throw new Error('Model connection changed before the credential was saved.')
      setModelKey(provider, endpoint, key)
    }
  )
  ipcMain.handle('research:set-key', async (_event, key: string) => {
    if (
      !(await nativeConsent(
        key ? 'Replace search credential?' : 'Delete search credential?',
        JSON.stringify(
          {
            provider: 'Brave Search',
            keyFingerprint: key ? createHash('sha256').update(key).digest('hex') : 'delete'
          },
          null,
          2
        )
      ))
    )
      throw new Error('Credential change cancelled.')
    setSearchKey(key)
  })
  const owner = (event: IpcMainInvokeEvent): BrowserWindow => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || !desktop.owns(event.sender) || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Unknown app window.')
    return win
  }
  ipcMain.handle('visuals:create', async (event, source: string) => {
    owner(event)
    return createVisual(event.sender, source)
  })
  ipcMain.handle('visuals:release', (event, id: string) => {
    if (event.senderFrame !== event.sender.mainFrame) return
    releaseVisual(event.sender, id)
  })
  ipcMain.handle('visuals:save', (event, id: string) =>
    desktop.keepOpen(() => saveVisual(owner(event), id))
  )
  ipcMain.handle('agent:send', async (_event, text: string, attachments: string[] = []) => {
    if (voice.active()) throw new Error('Finish or cancel the voice recording before sending.')
    await send(String(text ?? ''), attachments, desktop.interaction(_event.sender))
  })
  ipcMain.handle('agent:rerun', async (_event, chatId: string, itemId: string, text: string) => {
    if (voice.active()) throw new Error('Finish or cancel the voice recording before rerunning.')
    await rerun(chatId, itemId, text, desktop.interaction(_event.sender))
  })
  ipcMain.handle('session:get', snapshot)
  ipcMain.handle('session:github-context', (_event, chatId, context) =>
    setGithubContext(chatId, context)
  )
  ipcMain.handle('session:page', (_event, chatId, before) => chatPage(chatId, before))
  ipcMain.handle('session:action-details', (_event, id) => actionDetails(id))
  ipcMain.handle('session:clear', clear)
  ipcMain.handle('chats:create', () => createChat())
  ipcMain.handle('chats:select', (_event, id: string) => selectChat(id))
  ipcMain.handle('chats:rename', (_event, id: string, title: string) => renameChat(id, title))
  ipcMain.handle(
    'chats:move',
    (_event, id: string, categoryId: string | null, beforeId?: string | null) =>
      moveChat(id, categoryId, beforeId)
  )
  ipcMain.handle('chats:create-category', (_event, name: string) => createChatCategory(name))
  ipcMain.handle('chats:rename-category', (_event, id: string, name: string) =>
    renameChatCategory(id, name)
  )
  ipcMain.handle('chats:delete-category', (_event, id: string) => deleteChatCategory(id))

  ipcMain.handle('chats:delete', (_event, id: string) => deleteChat(id))
  ipcMain.handle('approval:resolve', (_event, id: string, decision: unknown) =>
    resolveApproval(id, decision)
  )
  ipcMain.handle('llm:status', getLlmStatus)
  ipcMain.handle('llm:models', listModels)
  ipcMain.handle('llm:modelInfo', () => getModelInfo())
  ipcMain.handle('llm:model-choices', () => listModelChoices())
  ipcMain.handle('llm:default-prompt', getDefaultPrompt)
  ipcMain.handle('tools:info', () => TOOL_INFO)
  ipcMain.handle('hardware:get', hardwareInfo)
  ipcMain.handle('attachments:pick', (event) => {
    return desktop.keepOpen(() => pickAttachments(owner(event)))
  })
  ipcMain.handle('attachments:preview', (_event, id: string) => previewAttachment(id))
  ipcMain.handle('attachments:save', (event, id: string) =>
    desktop.keepOpen(() => saveAttachment(id, owner(event)))
  )
  ipcMain.handle('attachments:screenshot', () => {
    if (settingsRecovery().required)
      throw new Error('Review security settings before capturing the screen.')
    return desktop.keepOpen(async () => {
      if (
        getSettings().tools.look_at_screen !== 'allow' &&
        !(await nativeConsent(
          'Capture the active window?',
          'A screenshot will be stored in this conversation. Sending it will disclose it to the configured model provider.'
        ))
      )
        throw new Error('Capture cancelled.')
      const result = await captureScreen({})
      if (typeof result === 'string') throw new Error(result)
      return storeImage(result.image)
    })
  })
  ipcMain.handle('files:workspace', (event) =>
    desktop.keepOpen(async () => {
      const result = await dialog.showOpenDialog(owner(event), {
        title: 'Choose Sophon’s working folder',
        properties: ['openDirectory'],
        defaultPath: getSettings().files.workspace || undefined
      })
      if (result.canceled) return null
      const workspace = await validateWorkspaceRoot(result.filePaths[0])
      if (
        synchronizedWorkspace(workspace) &&
        !(await nativeConsent(
          'Use a synchronized workspace?',
          `Folder: ${workspace}\nFiles written here may leave this computer through your sync client.`
        ))
      )
        return null
      updateSettings({ files: { workspace } })
      return workspace
    })
  )
  ipcMain.handle('files:revoke', () => {
    updateSettings({ files: { workspace: '' } })
  })
  ipcMain.handle('voice:get', () => voice.snapshot())
  ipcMain.handle('voice:devices-begin', (event) => voice.beginDeviceDetection(event.sender))
  ipcMain.handle('voice:devices-end', (event) => voice.endDeviceDetection(event.sender))
  ipcMain.handle('voice:start', (event) => voice.start(event.sender))
  ipcMain.handle('voice:stop', () => voice.stop())
  ipcMain.handle('voice:toggle', (event) => voice.toggle(event.sender))
  ipcMain.handle('voice:cancel', () => voice.cancel())
  ipcMain.on('voice:ready', (event, id: string) => voice.ready(event.sender, id))
  ipcMain.on('voice:audio', (event, id: string, audio: unknown) => {
    void voice.receive(event.sender, id, audio)
  })
  ipcMain.on('voice:error', (event, id: string, message: string) =>
    voice.captureError(event.sender, id, message)
  )
  ipcMain.on('voice:level', (event, id: string, value: number) => {
    if (voice.owns(event.sender, id) && Number.isFinite(value))
      broadcast('voice:level', Math.max(0, Math.min(1, value)))
  })
  ipcMain.handle('hotkeys:suspend', shortcuts.suspend)
  ipcMain.handle('hotkeys:resume', shortcuts.resume)
  ipcMain.handle('compact:presentation', () => desktop.presentation)
  ipcMain.handle('compact:work-area', () => desktop.compactWorkArea())
  ipcMain.on('compact:task-visible', (event, visible: unknown) => {
    if (event.sender === desktop.compact?.webContents && typeof visible === 'boolean')
      desktop.setCompactTaskVisible(visible)
  })
  ipcMain.on('compact:hide', desktop.hideCompact)
  ipcMain.on('compact:open-main', () => {
    desktop.showMain()
    desktop.hideCompact()
  })
  ipcMain.on('compact:resize', (_event, height: number, width?: number, mainOffset?: number) =>
    desktop.resizeCompact(height, width, mainOffset)
  )
  registerSettingsIpc(shortcuts, ipcMain)
}
