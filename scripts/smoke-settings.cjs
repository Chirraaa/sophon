const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { load, root } = require('./security/load.cjs')

async function main() {
  const directory = path.join(root, '.cache/settings-regression')
  fs.mkdirSync(directory, { recursive: true })
  const profile = fs.mkdtempSync(path.join(directory, 'profile-'))
  const registry = load('src/main/tools/registry.ts')
  let revocations = 0
  let failWrite = false
  const settings = load('src/main/settings.ts', {
    electron: { app: { isPackaged: false, getAppPath: () => root, getPath: () => profile } },
    path,
    crypto,
    fs: {
      ...fs,
      renameSync: (...args) => {
        if (failWrite) throw new Error('Disk unavailable')
        fs.renameSync(...args)
      }
    },
    '../shared/shortcut-contract': load('src/shared/shortcut-contract.ts'),
    './tools/registry': registry,
    './network/endpoint': load('src/main/network/endpoint.ts'),
    './security/run-manager': { revokePolicy: () => revocations++, assertRun: () => {} },
    './security/audit': { securityEvent: () => {} }
  })
  const file = path.join(profile, 'settings.json')
  assert.deepEqual(settings.loadSettings(), settings.DEFAULT_SETTINGS)
  assert.equal(settings.getSettings().voice.enabled, false)
  assert.equal(settings.draftSettings({ voice: { enabled: true } }).voice.enabled, true)
  assert.equal(settings.draftSettings({ voice: { enabled: 'true' } }).voice.enabled, false)
  assert.equal(settings.getSettings().showResponseDiagnostics, false)
  assert.equal(settings.draftSettings({ accent: '#12ABef' }).accent, '#12abef')
  assert.equal(settings.draftSettings({ accent: 'invalid' }).accent, 'violet')
  assert.equal(settings.getSettings().model.codingResources, 'auto')
  for (const effort of [
    'auto',
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'ultra'
  ]) {
    assert.equal(
      settings.draftSettings({ model: { reasoningEffort: effort } }).model.reasoningEffort,
      effort
    )
  }
  assert.equal(
    settings.draftSettings({ model: { reasoningEffort: 'invented' } }).model.reasoningEffort,
    'auto'
  )
  assert.equal(settings.getSettings().coding.mode, 'ask-before-edit')
  assert.equal(settings.draftSettings({ coding: { mode: 'auto' } }).coding.mode, 'auto')
  let modeConsent
  const consent = load('src/main/security/settings-consent.ts', {
    '../tools/registry': registry,
    './native-consent': {
      nativeConsent: async (...args) => {
        modeConsent = args
        return false
      }
    }
  })
  const strictMode = settings.getSettings()
  const automaticMode = settings.draftSettings({ coding: { mode: 'auto' } })
  assert(consent.securityLoosens(strictMode, automaticMode))
  assert.equal(consent.securityLoosens(automaticMode, strictMode), false)
  assert.equal(
    await consent.confirmSettings(strictMode, automaticMode),
    false,
    'Cancelling Auto consent rejects the change'
  )
  assert.match(JSON.stringify(modeConsent), /create and edit workspace files without asking/)
  assert.equal(
    settings.draftSettings({ coding: { mode: 'invalid' } }).coding.mode,
    'ask-before-edit'
  )
  assert.equal(
    settings.draftSettings({ model: { codingResources: 'conserve' } }).model.codingResources,
    'conserve'
  )
  assert.equal(
    settings.draftSettings({ model: { codingResources: 'expand' } }).model.codingResources,
    'expand'
  )
  assert.equal(
    settings.draftSettings({ model: { codingResources: 'unlimited' } }).model.codingResources,
    'auto'
  )
  for (const tool of registry.TOOL_INFO)
    assert.equal(settings.DEFAULT_SETTINGS.tools[tool.name], tool.default)

  const saved = structuredClone(settings.DEFAULT_SETTINGS)
  delete saved.profile
  saved.tools.run_npm = 'allow'
  saved.tools.delete_file = 'allow'
  delete saved.tools.delete_directory
  delete saved.tools.list_audio
  delete saved.model.codingResources
  delete saved.coding
  saved.voice.serverPath = 'C:\\old-install\\whisper-server.exe'
  saved.voice.modelPath = 'C:\\old-install\\ggml-base.bin'
  saved.hotkeys.talk = saved.hotkeys.summon
  saved.privacy.chatRetentionDays = 42
  fs.writeFileSync(file, JSON.stringify(saved))
  const migrated = settings.loadSettings()
  assert.equal(
    migrated.profile.onboardingComplete,
    true,
    'Existing users are not forced through setup'
  )
  assert.equal(migrated.coding.mode, 'ask-before-edit', 'Older profiles require edit approval')
  assert.equal(migrated.model.codingResources, 'auto', 'Older profiles migrate to automatic sizing')
  assert.equal(migrated.tools.run_npm, 'ask', 'npm must never advertise persistent approval')
  assert.equal(
    migrated.tools.delete_file,
    'ask',
    'Deletion must never advertise persistent approval'
  )
  assert.equal(
    migrated.tools.delete_directory,
    'block',
    'New deletion tools must not gain authority on load'
  )
  assert.equal(migrated.tools.list_audio, 'block', 'New tools must not gain authority on load')
  assert.deepEqual(migrated.hotkeys, settings.DEFAULT_SETTINGS.hotkeys)
  assert.equal(migrated.voice.serverPath, settings.DEFAULT_SETTINGS.voice.serverPath)
  assert.equal(migrated.voice.modelPath, settings.DEFAULT_SETTINGS.voice.modelPath)
  assert.equal(migrated.privacy.chatRetentionDays, 42)
  assert.equal(settings.settingsRecovery().required, false)
  assert.throws(
    () => settings.draftSettings({ hotkeys: { talk: migrated.hotkeys.summon } }),
    /different shortcuts/
  )
  assert.throws(
    () => settings.draftSettings({ hotkeys: { summon: migrated.hotkeys.talk } }),
    /different shortcuts/
  )
  const before = settings.getSettings()
  failWrite = true
  assert.throws(() => settings.updateSettings({ memory: { enabled: false } }), /save settings/)
  assert.deepEqual(settings.getSettings(), before)
  failWrite = false
  settings.updateSettings({ memory: { enabled: false } })
  settings.updateSettings({
    memory: { enabled: true },
    tools: { harness_manage: 'ask', python_calculate: 'ask', run_npm: 'allow' }
  })
  assert.equal(settings.getSettings().memory.enabled, true)
  assert.equal(settings.getSettings().tools.run_npm, 'ask')
  assert.equal(settings.loadSettings().memory.enabled, true)
  settings.updateSettings({ accent: '#12abef', showResponseDiagnostics: true })
  assert.equal(settings.loadSettings().accent, '#12abef')
  assert.equal(settings.getSettings().showResponseDiagnostics, true)
  settings.updateSettings({ model: { reasoningEffort: 'max' } })
  assert.equal(
    settings.loadSettings().model.reasoningEffort,
    'max',
    'Expanded effort survives a profile reload'
  )
  assert(revocations >= 2)
  const profileRevocations = revocations
  settings.updateSettings({
    profile: {
      name: '  Alex  ',
      uses: ['coding', 'unknown'],
      guidance: 'step-by-step',
      context: 'Learning TypeScript',
      onboardingComplete: true
    }
  })
  assert.deepEqual(settings.loadSettings().profile, {
    name: 'Alex',
    uses: ['coding'],
    guidance: 'step-by-step',
    context: 'Learning TypeScript',
    onboardingComplete: true
  })
  assert.equal(revocations, profileRevocations, 'Profile preferences do not alter permissions')
  const prompts = load('src/main/llm/prompt.ts', {
    '../settings': settings,
    './visuals': { VISUAL_CAPABILITIES: '', VISUAL_PROMPT: '' },
    './visual-routing': { INLINE_VISUAL_TASK: '' }
  })
  const personalized = prompts.buildSystemPrompt()
  assert(
    personalized.includes('Learning TypeScript') && personalized.includes('step-by-step'),
    'The system prompt includes saved personalization'
  )
  assert.equal(
    settings.draftSettings({ profile: { name: 'a'.repeat(100), context: 'b'.repeat(2000) } })
      .profile.name.length,
    60
  )
  assert.equal(
    settings.draftSettings({ profile: { guidance: 'unknown' } }).profile.guidance,
    'step-by-step'
  )

  const previousWindow = global.window
  try {
    global.window = { api: { updateSettings: async () => ({ ok: true, settings: before }) } }
    const saving = load('src/renderer/src/components/settings/save.ts', {
      react: { useSyncExternalStore: (_subscribe, snapshot) => snapshot() }
    })
    assert.equal((await saving.save({ accent: 'blue' })).ok, true)
    assert.deepEqual(saving.useSettingsSave(), { pending: 0, error: '' })
    global.window.api.updateSettings = async () => ({ ok: false, error: 'Change cancelled' })
    assert.equal((await saving.save({ accent: 'blue' })).ok, false)
    assert.equal(saving.useSettingsSave().error, 'Change cancelled')
    global.window.api.updateSettings = async () => {
      throw new Error('IPC unavailable')
    }
    assert.deepEqual(await saving.save({ accent: 'blue' }), { ok: false, error: 'IPC unavailable' })
    assert.equal(saving.useSettingsSave().pending, 0)
    let complete
    global.window.api.updateSettings = () =>
      new Promise((resolve) => {
        complete = resolve
      })
    const pending = saving.save({ accent: 'rose' })
    assert.equal(saving.useSettingsSave().pending, 1)
    complete({ ok: true, settings: before })
    await pending
    assert.deepEqual(saving.useSettingsSave(), { pending: 0, error: '' })
  } finally {
    if (previousWindow === undefined) delete global.window
    else global.window = previousWindow
  }

  {
    const state = []
    let cursor = 0
    const colors = []
    const component = (name) => name
    const { ColorField } = load('src/renderer/src/components/settings/fields/ColorField.tsx', {
      react: {
        useState: (initial) => {
          const index = cursor++
          if (!(index in state)) state[index] = initial
          return [
            state[index],
            (next) => {
              state[index] = next
            }
          ]
        }
      },
      'react/jsx-runtime': require('react/jsx-runtime'),
      '@/components/ui/button': { Button: component('Button') },
      '@/components/ui/input': { Input: component('Input') },
      '@/components/ui/slider': { Slider: component('Slider') },
      '@/components/ui/dialog': Object.fromEntries(
        ['Dialog', 'DialogContent', 'DialogDescription', 'DialogTitle'].map((name) => [
          name,
          component(name)
        ])
      )
    })
    const render = () => {
      cursor = 0
      return ColorField({ value: '#000000', label: 'Color', onCommit: (v) => colors.push(v) })
    }
    const flatten = (node) =>
      !node || typeof node !== 'object'
        ? []
        : [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)]
    const find = (predicate) => flatten(render()).find(predicate)
    render().props.onOpenChange(true)
    for (let i = 0; i <= 100; i++) find((node) => node.type === 'Slider').props.onValueChange([i])
    assert.deepEqual(colors, [], 'Dragging never writes settings')
    find((node) => node.props?.children === 'Apply color').props.onClick()
    assert.deepEqual(colors, ['#640000'])
    render().props.onOpenChange(true)
    find((node) => node.type === 'Input').props.onChange({ target: { value: '#abcdef' } })
    find((node) => node.props?.children === 'Cancel').props.onClick()
    assert.deepEqual(colors, ['#640000'], 'Cancel keeps saved color')
    render().props.onOpenChange(true)
    find((node) => node.type === 'Input').props.onChange({ target: { value: 'invalid' } })
    assert.equal(find((node) => node.props?.children === 'Apply color').props.disabled, true)
  }
  console.log(
    'PASS settings migration, grants, voice paths, shortcuts, persistence, save feedback and color picker bursts'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
