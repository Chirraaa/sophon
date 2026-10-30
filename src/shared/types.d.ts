import type { PluginsApi } from './plugins'
import type { UpdatesApi } from './updates'
export {}
declare global {
  type ModelProvider = 'local' | 'openai' | 'compatible' | 'chatgpt' | 'anthropic' | 'claude'
  type LlamaOptions = import('./llama-server').LlamaOptions
  type LlamaCapabilities = import('./llama-server').LlamaCapabilities
  interface LlamaStatus {
    state: 'stopped' | 'starting' | 'running' | 'error'
    port?: number
    pid?: number
    error?: string
    log: string
  }
  interface LlamaView {
    config: {
      enabled: boolean
      executable: string
      modelPath: string
      caps: LlamaCapabilities | null
      options: LlamaOptions
    }
    status: LlamaStatus
    applied: LlamaOptions | null
  }
  type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
  interface ModelCapabilities {
    reasoningEfforts?: ReasoningEffort[]
    defaultReasoningEffort?: ReasoningEffort
    contextWindow?: number
    reasoningSource?: 'provider' | 'documented'
    contextSource?: 'provider' | 'documented'
  }
  interface TokenUsage {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cachedInputTokens?: number
    reasoningTokens?: number
  }
  interface RequestUsage {
    calls: number
    reportedCalls: number
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cachedInputTokens: number
    reasoningTokens: number
    cachedReportedCalls: number
    reasoningReportedCalls: number
  }
  interface RequestTiming {
    wallMs: number
    modelMs: number
    modelCalls: number
    toolMs: number
    toolCalls: number
    approvalMs: number
    approvals: number
    captureMs: number
    captures: number
    automationMs: number
    automationCalls: number
  }
  type ContextCategory =
    | 'instructions'
    | 'history'
    | 'request'
    | 'attachments'
    | 'memories'
    | 'toolResults'
    | 'toolCalls'
    | 'reasoning'
    | 'overhead'
    | 'tools'
  interface ContextMeasurements {
    estimatedInputTokens: number
    inputBudget: number | null
    reservedOutputTokens: number
    model?: string
    provider?: ModelProvider
    measuredAt?: number
    contextWindow?: number | null
    windowSource?: 'configured' | 'provider' | 'documented' | 'unknown'
    estimatedTotalTokens?: number
    /** Estimate before scaling by the model's measured ratio. */
    rawEstimatedTokens?: number
    /** The estimate is scaled by the ratio measured on this model's last request. */
    calibrated?: boolean
    /** Provider-reported prompt tokens of the latest main request. */
    reportedInputTokens?: number
    reportedOutputTokens?: number
    /** Largest measured main request (prompt plus reply) in this reply. */
    peakTokens?: number
    headroomTokens?: number
    breakdown?: { category: ContextCategory; tokens: number }[]
  }
  interface ChatgptStatus {
    activeId?: string
    pending: boolean
    welcome: boolean
    accounts: {
      id: string
      email: string
      label: string
      signedIn: boolean
      planEnabled: boolean
    }[]
  }
  interface MicrosoftStatus {
    clientId: string
    pending: boolean
    activeId?: string
    accounts: {
      id: string
      email: string
      name: string
      signedIn: boolean
      calendar: boolean
    }[]
  }
  type PageDestination = 'reader' | 'browser'
  interface PagePreview {
    pages?: string[]
    url: string
    title: string
    text: string
    truncated: boolean
  }

  type TaskMode = 'assistant'
  type WorkflowPhase = 'inspect' | 'act' | 'verify' | 'respond' | 'finished'
  type WorkflowOutcome =
    'running' | 'answered' | 'actions_checked' | 'needs_review' | 'blocked' | 'interrupted'
  type EvidenceStatus =
    'pending' | 'observed' | 'reported' | 'verified' | 'failed' | 'denied' | 'uncertain'
  interface ActionEvidence {
    code?: string
    actionId: string
    runId: string
    tool: string
    target: string
    status: EvidenceStatus
    summary: string
    at: number
  }
  interface WorkflowState {
    version: 1
    id: string
    mode: TaskMode
    workspaceKey: string
    goal: string
    phase: WorkflowPhase
    outcome: WorkflowOutcome
    nextStep: string
    evidence: ActionEvidence[]
    omittedEvidence: number
    codingPaths?: string[]
    mutationRevision?: number
    codingSession?: CodingSessionState
    updatedAt: number
  }
  interface CodingTaskState {
    id: string
    title: string
    dependsOn: string[]
    tools: string[]
    skill: string
    profile: string
    status: 'pending' | 'active' | 'implemented' | 'verified'
  }
  interface CodingSessionState {
    version: 1
    plan: string
    tasks: CodingTaskState[]
    docs: string
    decisions: string
    lesson: string
    inspections: string[]
    trace: string[]
    changes: string[]
    revision: number
    checkpointRevision: number
    compactions: number
    verification: string
  }
  type MemoryKind = 'preference' | 'fact' | 'procedure' | 'task'
  type MemoryScope = 'global' | 'workspace' | 'chat'
  interface MemoryDraft {
    id?: string
    title: string
    content: string
    kind: MemoryKind
    scope: MemoryScope
    pinned: boolean
  }
  interface MemoryRecord extends MemoryDraft {
    id: string
    scopeKey: string
    source: 'user'
    createdAt: number
    updatedAt: number
  }
  interface CodingResourceState {
    preference: 'auto' | 'conserve' | 'expand'
    readChars: number
    editChars: number
    maxReadChars: number
    maxEditChars: number
    hardEditChars: number
    hardArgumentChars: number
    remainingContextTokens: number | null
    outputTokens: number | null
  }
  interface ContextCompaction {
    version: 1
    count: number
    turns: number
    messages: number
    beforeTokens: number
    afterTokens: number
    updatedAt: number
    method: 'model' | 'excerpts'
  }
  // A user-facing notice that earlier context was compacted during a reply:
  // older conversation summarized, or a coding task trimmed to its checkpoint.
  interface ContextCompactionNotice {
    status: 'running' | 'done'
    scope: 'conversation' | 'task'
    info?: ContextCompaction
  }
  interface ContextReport extends ContextMeasurements {
    compaction?: ContextCompaction
    droppedTurns: number
    memories: { id: string; title: string }[]
    playbooks: string[]
    guidance?: string[]
    availableTools?: string[]
    codingResources?: CodingResourceState
  }
  type SpecialistId = 'simple' | 'researcher' | 'visual_explainer' | 'tutor' | 'reviewer'
  interface SpecialistRun {
    id: string
    profile: SpecialistId
    status: 'running' | 'done' | 'failed'
    task: string
    summary?: string
    modelCalls: number
    estimatedInputTokens: number
  }
  interface ResearchSource {
    id: string
    taskId: string
    title: string
    url: string
    snippet: string
    fetchedAt: string
    provenance: 'untrusted-web'
  }
  type AccentName = 'violet' | 'blue' | 'teal' | 'rose' | 'amber' | `#${string}`
  type ToolPermission = 'allow' | 'ask' | 'block'
  type ReplyStyle = 'terse' | 'normal'
  type VoiceLanguage = 'auto' | 'en' | 'de' | 'fr'
  type VoiceCompute = 'auto' | 'cpu' | 'gpu'
  type TalkMode = 'hold' | 'toggle'
  interface VoiceSnapshot {
    phase: 'idle' | 'starting' | 'listening' | 'transcribing' | 'error'
    id?: string
    error?: string
  }
  interface VoiceCaptureEvent {
    command: 'start' | 'stop' | 'cancel'
    id: string
  }
  interface ChatAttachment {
    id: string
    name: string
    mimeType: string
    size: number
  }
  interface GithubContext {
    serverId: string
    account: string
    repository: string
    branch: string
  }
  interface ChatInfo {
    githubContext?: GithubContext
    id: string
    title: string
    updatedAt: number
    categoryId?: string
  }
  interface ChatCategory {
    id: string
    name: string
  }
  interface CompactPresentation {
    mode: 'command' | 'voice'
    token: number
    docked?: boolean
    notice?: 'finished'
  }
  interface HardwareInfo {
    os: string
    cpu: string
    logicalCores: number
    memoryTotal: number
    memoryFree: number
    graphics: string[]
    displays: {
      name: string
      width: number
      height: number
      scale: number
      refreshRate: number
      primary: boolean
    }[]
  }
  interface AppSettings {
    policyVersion: number
    profile: {
      onboardingComplete: boolean
      name: string
      uses: string[]
      guidance: 'balanced' | 'step-by-step' | 'direct'
      context: string
    }
    coding: { mode: 'auto' | 'ask-before-edit' }
    research: { enabled: boolean; provider: 'exa' | 'duckduckgo' | 'brave' }
    privacy: { chatRetentionDays: number }
    accent: AccentName
    motion: 'full' | 'system' | 'reduced'
    showResponseDiagnostics: boolean
    screenGlow: { enabled: boolean; color: string }
    closeToTray: boolean
    dockNotify: boolean
    dockAlwaysVisible: boolean
    launchAtStartup: boolean
    hotkeys: {
      summon: string
      talk: string
    }
    model: {
      provider: ModelProvider
      contextWindow: number
      endpoint: string
      modelId: string
      temperature: number
      maxTokens: number
      historyTurns: number
      maxSteps: number
      thinking: boolean
      reasoningEffort: 'auto' | ReasoningEffort
      specialists: boolean
      codingResources: 'auto' | 'conserve' | 'expand'
    }
    behavior: {
      systemPrompt: string
      style: ReplyStyle
      neverDo: string
    }
    memory: { enabled: boolean; maxTokens: number }
    tools: Record<string, ToolPermission>
    rules: {
      blockedApps: string[]
      protectedWindows: string[]
    }
    files: {
      workspace: string
    }
    voice: {
      enabled: boolean
      deviceId: string
      language: VoiceLanguage
      compute: VoiceCompute
      mode: TalkMode
      serverPath: string
      modelPath: string
    }
  }
  type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K]
  }
  type SettingsPatch = DeepPartial<AppSettings>
  interface SettingsResult {
    ok: boolean
    error?: string
    settings: AppSettings
  }
  interface ToolInfo {
    name: string
    label: string
    description: string
    default: ToolPermission
  }
  type InteractionContext = { surface: 'shortcut' | 'full-app'; input: 'text' | 'voice' }
  type InterfacePresence = {
    fullAppVisible: boolean
    shortcutVisible: boolean
    focused: 'shortcut' | 'full-app' | null
  }
  type ApprovalDecision = 'once' | 'always' | 'deny'
  type ToolActionStatus = 'running' | 'waiting' | 'done' | 'failed'
  interface ToolAction {
    detailsStored?: boolean
    id: string
    name: string
    label: string
    status: ToolActionStatus
    detail?: string
    preview?: string
    canAlwaysAllow?: boolean
  }
  interface ModelProgress {
    toolName: string
    generatedChars: number
  }
  interface ChatItem {
    modelProgress?: ModelProgress
    quality?: 'checking' | 'reviewed'
    specialists?: SpecialistRun[]
    compaction?: ContextCompactionNotice
    workflow?: WorkflowState
    context?: ContextReport
    usage?: RequestUsage
    timing?: RequestTiming
    sources?: ResearchSource[]
    id: string
    from: 'you' | 'agent'
    text: string
    attachments?: ChatAttachment[]
    actions: ToolAction[]
    pending: boolean
  }
  interface SessionSnapshot {
    githubContext?: GithubContext
    totalItems?: number
    mode: TaskMode
    chatId: string
    chats: ChatInfo[]
    categories?: ChatCategory[]
    runningChatId: string | null
    items: ChatItem[]
    busy: boolean
  }
  interface LlmStatus {
    online: boolean
    model?: string
  }
  interface ModelChoice extends ModelCapabilities {
    id: string
    label: string
  }
  interface Api {
    updates: UpdatesApi
    setGithubContext: (chatId: string, context: GithubContext | null) => Promise<void>
    plugins: PluginsApi
    pages: {
      preference: () => Promise<PageDestination | null>
      open: (
        url: string,
        destination: PageDestination,
        remember: boolean
      ) => Promise<PagePreview | null>
    }
    consent: {
      read: () => Promise<ConsentReview | null>
      resolve: (id: string, allow: boolean) => Promise<void>
      onChange: (cb: (review: ConsentReview | null) => void) => () => void
    }
    memory: {
      list: () => Promise<MemoryRecord[]>
      save: (draft: MemoryDraft) => Promise<MemoryRecord[]>
      delete: (id: string) => Promise<MemoryRecord[]>
    }
    harness: {
      list: () => Promise<{ directory: string; documents: string[] }>
      read: (category: string, name: string) => Promise<string>
    }
    copyText: (text: string) => Promise<void>
    editText: (action: 'cut' | 'paste' | 'selectAll' | 'undo' | 'redo') => Promise<void>
    settingsRecovery: () => Promise<{ required: boolean; backup?: string }>
    reviewSettingsRecovery: () => Promise<void>
    removeWorkspace: () => Promise<void>
    clearSecurityEvents: () => Promise<number>
    stop: () => Promise<void>
    llama: {
      get: () => Promise<LlamaView>
      setEnabled: (enabled: boolean) => Promise<LlamaView>
      // Both pickers resolve to null when the user cancels.
      pickExecutable: () => Promise<LlamaView | null>
      pickModel: () => Promise<LlamaView | null>
      setOptions: (patch: Partial<LlamaOptions>) => Promise<LlamaView>
      start: () => Promise<LlamaView>
      stop: () => Promise<LlamaView>
      onStatus: (cb: (status: LlamaStatus) => void) => () => void
    }
    research: {
      hasKey: () => Promise<boolean>
      setKey: (key: string) => Promise<void>
    }
    modelCredentials: {
      hasKey: (provider: ModelProvider, endpoint: string) => Promise<boolean>
      setKey: (provider: ModelProvider, endpoint: string, key: string) => Promise<void>
    }
    chatgpt: {
      status: () => Promise<ChatgptStatus>
      signIn: (accountId?: string) => Promise<ChatgptStatus>
      cancel: () => Promise<void>
      select: (accountId: string) => Promise<ChatgptStatus>
      signOut: () => Promise<{ status: ChatgptStatus; revoked: boolean }>
      acknowledgeWelcome: () => Promise<void>
      manageUsage: () => Promise<void>
    }
    microsoft: {
      status: () => Promise<MicrosoftStatus>
      setClientId: (clientId: string) => Promise<MicrosoftStatus>
      signIn: (accountId?: string) => Promise<MicrosoftStatus>
      cancel: () => Promise<void>
      select: (accountId: string) => Promise<MicrosoftStatus>
      remove: (accountId: string) => Promise<MicrosoftStatus>
    }
    visuals: {
      image: (dataUrl: string) => Promise<{ id: string; url: string }>
      diagram: (source: string) => Promise<{ id: string; url: string }>
      create: (source: string) => Promise<{ id: string; url: string } | null>
      release: (id: string) => Promise<void>
      save: (id: string) => Promise<void>
    }
    send: (text: string, attachments?: string[]) => Promise<void>
    rerun: (chatId: string, itemId: string, text: string) => Promise<void>
    chats: {
      create: () => Promise<void>
      select: (id: string) => Promise<void>
      rename: (id: string, title: string) => Promise<void>
      delete: (id: string) => Promise<void>
      move: (id: string, categoryId: string | null, beforeId?: string | null) => Promise<void>
      createCategory: (name: string) => Promise<void>
      renameCategory: (id: string, name: string) => Promise<void>
      deleteCategory: (id: string) => Promise<void>
    }
    attachments: {
      pick: () => Promise<ChatAttachment[]>
      screenshot: () => Promise<ChatAttachment>
      preview: (id: string) => Promise<{
        url?: string
        text?: string
      }>
      save: (id: string) => Promise<void>
    }
    hardware: () => Promise<HardwareInfo>
    pickWorkspace: () => Promise<string | null>
    getSession: () => Promise<SessionSnapshot>
    getChatPage: (
      chatId: string,
      before: number
    ) => Promise<{ items: ChatItem[]; start: number; total: number }>
    getActionDetails: (id: string) => Promise<{ preview?: string; detail?: string }>
    onSessionText: (
      cb: (update: { chatId: string; itemId: string; text: string }) => void
    ) => () => void
    onSession: (cb: (s: SessionSnapshot) => void) => () => void
    clearSession: () => Promise<void>
    approve: (actionId: string, decision: ApprovalDecision) => Promise<void>
    getSettings: () => Promise<AppSettings>
    updateSettings: (patch: SettingsPatch) => Promise<SettingsResult>
    resetSettings: () => Promise<AppSettings>
    onSettings: (cb: (s: AppSettings) => void) => () => void
    llmStatus: () => Promise<LlmStatus>
    llmModelChoices: () => Promise<ModelChoice[]>
    llmModelInfo: () => Promise<ModelChoice>
    defaultPrompt: () => Promise<string>
    toolsInfo: () => Promise<ToolInfo[]>
    voice: {
      level: (id: string, value: number) => void
      beginDeviceDetection: () => Promise<void>
      endDeviceDetection: () => Promise<void>
      onLevel: (cb: (level: number) => void) => () => void
      getState: () => Promise<VoiceSnapshot>
      onState: (cb: (state: VoiceSnapshot) => void) => () => void
      onCapture: (cb: (event: VoiceCaptureEvent) => void) => () => void
      start: () => Promise<void>
      stop: () => Promise<void>
      toggle: () => Promise<void>
      cancel: () => Promise<void>
      ready: (id: string) => void
      audio: (id: string, audio: Uint8Array) => void
      error: (id: string, message: string) => void
    }
    hotkeys: {
      suspend: () => Promise<void>
      resume: () => Promise<void>
    }
    compact: {
      hide: () => void
      resize: (height: number, width?: number, mainOffset?: number) => void
      setDocked: (docked: boolean) => void
      setTaskVisible: (visible: boolean) => void
      workArea: () => Promise<{ width: number; height: number }>
      onWorkArea: (cb: (area: { width: number; height: number }) => void) => () => void
      openMain: () => void
      presentation: () => Promise<CompactPresentation>
      onShown: (cb: (presentation: CompactPresentation) => void) => () => void
    }
  }
  interface Window {
    api: Api
  }
  interface ConsentReview {
    id: string
    title: string
    summary: string
    detail: string
    confirmLabel: string
    changes: { label: string; before: string; after: string }[]
    showDetails?: boolean
    accent: AccentName
    motion: AppSettings['motion']
  }
}
