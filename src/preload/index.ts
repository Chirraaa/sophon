import { contextBridge, ipcRenderer } from 'electron'
function listen<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}
const api: Api = {
  updates: {
    get: () => ipcRenderer.invoke('updates:get'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    acknowledge: () => ipcRenderer.invoke('updates:acknowledge'),
    onChange: (cb) => listen('updates:changed', cb)
  },
  setGithubContext: (chatId, context) =>
    ipcRenderer.invoke('session:github-context', chatId, context),
  pages: {
    preference: () => ipcRenderer.invoke('pages:preference'),
    open: (url, destination, remember) =>
      ipcRenderer.invoke('pages:open', url, destination, remember)
  },
  consent: {
    read: () => ipcRenderer.invoke('consent:read'),
    resolve: (id, allow) => ipcRenderer.invoke('consent:resolve', id, allow),
    onChange: (cb) => listen('consent:changed', cb)
  },
  memory: {
    list: () => ipcRenderer.invoke('memory:list'),
    save: (draft) => ipcRenderer.invoke('memory:save', draft),
    delete: (id) => ipcRenderer.invoke('memory:delete', id)
  },
  harness: {
    list: () => ipcRenderer.invoke('harness:list'),
    read: (category, name) => ipcRenderer.invoke('harness:read', category, name)
  },
  plugins: {
    onGithubHistory: (callback) => listen('github:history-changed', callback),
    onGithubCheckout: (callback) => listen('github:checkout-changed', callback),
    githubHistory: (context, action) => ipcRenderer.invoke('github:history', context, action),
    githubCheckout: (context, action) => ipcRenderer.invoke('github:checkout', context, action),
    githubAccounts: () => ipcRenderer.invoke('github:accounts'),
    githubSignInConfigured: () => ipcRenderer.invoke('github:sign-in-configured'),
    githubSignIn: (clientId) => ipcRenderer.invoke('github:sign-in', clientId),
    githubPollSignIn: (id) => ipcRenderer.invoke('github:poll-sign-in', id),
    githubCancelSignIn: (id) => ipcRenderer.invoke('github:cancel-sign-in', id),
    githubCall: (id, tool, argumentsJson) =>
      ipcRenderer.invoke('github:call', id, tool, argumentsJson),
    list: () => ipcRenderer.invoke('plugins:list'),
    importFolder: () => ipcRenderer.invoke('plugins:import'),
    enablePlugin: (id, enabled) => ipcRenderer.invoke('plugins:enable', id, enabled),
    removePlugin: (id) => ipcRenderer.invoke('plugins:remove', id),
    addServer: (name, configuration) =>
      ipcRenderer.invoke('plugins:add-server', name, configuration),
    updateServer: (id, name, configuration) =>
      ipcRenderer.invoke('plugins:update-server', id, name, configuration),
    enableServer: (id, enabled) => ipcRenderer.invoke('plugins:enable-server', id, enabled),
    removeServer: (id) => ipcRenderer.invoke('plugins:remove-server', id),
    connect: (id) => ipcRenderer.invoke('plugins:connect', id),
    disconnect: (id) => ipcRenderer.invoke('plugins:disconnect', id)
  },
  copyText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  editText: (action) => ipcRenderer.invoke('text:edit', action),
  settingsRecovery: () => ipcRenderer.invoke('settings:recovery'),
  reviewSettingsRecovery: () => ipcRenderer.invoke('settings:review-recovery'),
  removeWorkspace: () => ipcRenderer.invoke('files:revoke'),
  clearSecurityEvents: () => ipcRenderer.invoke('privacy:clear-security-events'),
  stop: () => ipcRenderer.invoke('agent:stop'),
  research: {
    hasKey: () => ipcRenderer.invoke('research:has-key'),
    setKey: (key) => ipcRenderer.invoke('research:set-key', key)
  },
  modelCredentials: {
    hasKey: (provider, endpoint) => ipcRenderer.invoke('model:has-key', provider, endpoint),
    setKey: (provider, endpoint, key) =>
      ipcRenderer.invoke('model:set-key', provider, endpoint, key)
  },
  chatgpt: {
    status: () => ipcRenderer.invoke('chatgpt:status'),
    signIn: (accountId) => ipcRenderer.invoke('chatgpt:sign-in', accountId),
    cancel: () => ipcRenderer.invoke('chatgpt:cancel'),
    select: (accountId) => ipcRenderer.invoke('chatgpt:select', accountId),
    signOut: () => ipcRenderer.invoke('chatgpt:sign-out'),
    acknowledgeWelcome: () => ipcRenderer.invoke('chatgpt:welcome'),
    manageUsage: () => ipcRenderer.invoke('chatgpt:usage')
  },
  microsoft: {
    status: () => ipcRenderer.invoke('microsoft:status'),
    setClientId: (clientId) => ipcRenderer.invoke('microsoft:set-client', clientId),
    signIn: (accountId) => ipcRenderer.invoke('microsoft:sign-in', accountId),
    cancel: () => ipcRenderer.invoke('microsoft:cancel'),
    select: (accountId) => ipcRenderer.invoke('microsoft:select', accountId),
    remove: (accountId) => ipcRenderer.invoke('microsoft:remove', accountId)
  },
  visuals: {
    image: (dataUrl) => ipcRenderer.invoke('visuals:image', dataUrl),
    diagram: (source) => ipcRenderer.invoke('visuals:diagram', source),
    create: (source) => ipcRenderer.invoke('visuals:create', source),
    release: (id) => ipcRenderer.invoke('visuals:release', id),
    save: (id) => ipcRenderer.invoke('visuals:save', id)
  },
  send: (text, attachments) => ipcRenderer.invoke('agent:send', text, attachments),
  rerun: (chatId, itemId, text) => ipcRenderer.invoke('agent:rerun', chatId, itemId, text),
  chats: {
    create: () => ipcRenderer.invoke('chats:create'),
    select: (id) => ipcRenderer.invoke('chats:select', id),
    rename: (id, title) => ipcRenderer.invoke('chats:rename', id, title),
    delete: (id) => ipcRenderer.invoke('chats:delete', id),
    move: (id, categoryId, beforeId = null) =>
      ipcRenderer.invoke('chats:move', id, categoryId, beforeId),
    createCategory: (name) => ipcRenderer.invoke('chats:create-category', name),
    renameCategory: (id, name) => ipcRenderer.invoke('chats:rename-category', id, name),
    deleteCategory: (id) => ipcRenderer.invoke('chats:delete-category', id)
  },
  attachments: {
    pick: () => ipcRenderer.invoke('attachments:pick'),
    screenshot: () => ipcRenderer.invoke('attachments:screenshot'),
    preview: (id) => ipcRenderer.invoke('attachments:preview', id),
    save: (id) => ipcRenderer.invoke('attachments:save', id)
  },
  hardware: () => ipcRenderer.invoke('hardware:get'),
  pickWorkspace: () => ipcRenderer.invoke('files:workspace'),
  getSession: () => ipcRenderer.invoke('session:get'),
  getChatPage: (chatId, before) => ipcRenderer.invoke('session:page', chatId, before),
  getActionDetails: (id) => ipcRenderer.invoke('session:action-details', id),
  onSessionText: (cb) => listen('session:text', cb),
  onSession: (cb) => listen('session:update', cb),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  approve: (actionId, decision) => ipcRenderer.invoke('approval:resolve', actionId, decision),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  onSettings: (cb) => listen('settings:changed', cb),
  llmStatus: () => ipcRenderer.invoke('llm:status'),
  llmModels: () => ipcRenderer.invoke('llm:models'),
  llmModelInfo: () => ipcRenderer.invoke('llm:modelInfo'),
  llmModelChoices: () => ipcRenderer.invoke('llm:model-choices'),
  defaultPrompt: () => ipcRenderer.invoke('llm:default-prompt'),
  toolsInfo: () => ipcRenderer.invoke('tools:info'),
  voice: {
    beginDeviceDetection: () => ipcRenderer.invoke('voice:devices-begin'),
    endDeviceDetection: () => ipcRenderer.invoke('voice:devices-end'),
    level: (id, value) => ipcRenderer.send('voice:level', id, value),
    onLevel: (cb) => listen('voice:level', cb),
    getState: () => ipcRenderer.invoke('voice:get'),
    onState: (cb) => listen('voice:state', cb),
    onCapture: (cb) => listen('voice:capture', cb),
    start: () => ipcRenderer.invoke('voice:start'),
    stop: () => ipcRenderer.invoke('voice:stop'),
    toggle: () => ipcRenderer.invoke('voice:toggle'),
    cancel: () => ipcRenderer.invoke('voice:cancel'),
    ready: (id) => ipcRenderer.send('voice:ready', id),
    audio: (id, audio) => ipcRenderer.send('voice:audio', id, audio),
    error: (id, message) => ipcRenderer.send('voice:error', id, message)
  },
  hotkeys: {
    suspend: () => ipcRenderer.invoke('hotkeys:suspend'),
    resume: () => ipcRenderer.invoke('hotkeys:resume')
  },
  compact: {
    hide: () => ipcRenderer.send('compact:hide'),
    setDocked: (docked) => ipcRenderer.send('compact:dock', docked),
    setTaskVisible: (visible) => ipcRenderer.send('compact:task-visible', visible),
    workArea: () => ipcRenderer.invoke('compact:work-area'),
    onWorkArea: (cb) => listen<{ width: number; height: number }>('compact:work-area', cb),
    resize: (height, width, mainOffset) =>
      width === undefined
        ? ipcRenderer.send('compact:resize', height)
        : mainOffset === undefined
          ? ipcRenderer.send('compact:resize', height, width)
          : ipcRenderer.send('compact:resize', height, width, mainOffset),
    openMain: () => ipcRenderer.send('compact:open-main'),
    presentation: () => ipcRenderer.invoke('compact:presentation'),
    onShown: (cb) => listen<CompactPresentation>('compact:shown', cb)
  }
}
if (!process.contextIsolated) throw new Error('Sophon requires context isolation.')
contextBridge.exposeInMainWorld('api', api)
