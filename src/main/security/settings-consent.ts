import { nativeConsent } from './native-consent'
import { TOOL_INFO } from '../tools/registry'
export function securityLoosens(before: AppSettings, after: AppSettings): boolean {
  const removed = (old: string[], next: string[]): boolean =>
    old.some((value) => !next.some((item) => item.toLowerCase() === value.toLowerCase()))
  return (
    (before.coding?.mode !== 'auto' && after.coding?.mode === 'auto') ||
    before.model.endpoint !== after.model.endpoint ||
    before.model.provider !== after.model.provider ||
    before.files.workspace !== after.files.workspace ||
    (!before.research.enabled && after.research.enabled) ||
    (after.research.enabled && before.research.provider !== after.research.provider) ||
    removed(before.rules.blockedApps, after.rules.blockedApps) ||
    removed(before.rules.protectedWindows, after.rules.protectedWindows) ||
    Object.keys(after.tools).some(
      (name) =>
        (before.tools[name] === 'block' && after.tools[name] !== 'block') ||
        (before.tools[name] !== 'allow' && after.tools[name] === 'allow')
    ) ||
    before.privacy.chatRetentionDays !== after.privacy.chatRetentionDays ||
    JSON.stringify(before.hotkeys) !== JSON.stringify(after.hotkeys)
  )
}
export async function confirmSettings(
  before: AppSettings,
  after: AppSettings,
  reset = false
): Promise<boolean> {
  if (!reset && !securityLoosens(before, after)) return true
  const changes: { label: string; before: string; after: string }[] = []
  if (before.coding?.mode !== after.coding?.mode)
    changes.push({
      label: 'Coding edits',
      before: before.coding?.mode === 'auto' ? 'Auto' : 'Ask before edit',
      after:
        after.coding?.mode === 'auto'
          ? 'Auto: create and edit workspace files without asking. Commands and deletions still ask.'
          : 'Ask before edit'
    })
  const permissionLabel = (permission: string): string =>
    ({ allow: 'Always allow', ask: 'Ask first', block: 'Block' })[permission] ?? permission
  for (const tool of TOOL_INFO)
    if (before.tools[tool.name] !== after.tools[tool.name])
      changes.push({
        label: tool.label,
        before: permissionLabel(before.tools[tool.name] ?? 'block'),
        after: permissionLabel(after.tools[tool.name] ?? 'block')
      })
  if (
    before.research.enabled !== after.research.enabled ||
    before.research.provider !== after.research.provider
  )
    changes.push({
      label: 'Web access',
      before: before.research.enabled ? before.research.provider : 'Disabled',
      after: after.research.enabled ? after.research.provider : 'Disabled'
    })
  if (
    before.model.endpoint !== after.model.endpoint ||
    before.model.provider !== after.model.provider
  )
    changes.push({
      label: 'Model server',
      before: `${before.model.provider ?? 'local'}: ${before.model.endpoint}`,
      after: `${after.model.provider ?? 'local'}: ${after.model.endpoint}`
    })
  if (before.files.workspace !== after.files.workspace)
    changes.push({
      label: 'Working folder',
      before: before.files.workspace || 'None',
      after: after.files.workspace || 'None'
    })
  if (JSON.stringify(before.rules) !== JSON.stringify(after.rules))
    changes.push({
      label: 'App protection rules',
      before: 'Current rules',
      after: 'Updated rules (details below)'
    })
  if (before.privacy.chatRetentionDays !== after.privacy.chatRetentionDays)
    changes.push({
      label: 'Conversation retention',
      before: `${before.privacy.chatRetentionDays || 'Unlimited'} days`,
      after: `${after.privacy.chatRetentionDays || 'Unlimited'} days`
    })
  if (JSON.stringify(before.hotkeys) !== JSON.stringify(after.hotkeys))
    changes.push({
      label: 'Keyboard shortcuts',
      before: 'Current shortcuts',
      after: 'Updated shortcuts (details below)'
    })
  const alwaysAllow = changes.some((change) => change.after === 'Always allow')
  const controls = (s: AppSettings): unknown => ({
    endpoint: s.model.endpoint,
    provider: s.model.provider,
    workspace: s.files.workspace,
    researchEnabled: s.research.enabled,
    searchProvider: s.research.provider,
    rules: s.rules,
    tools: s.tools,
    coding: s.coding,
    hotkeys: s.hotkeys,
    retentionDays: s.privacy.chatRetentionDays
  })
  return nativeConsent(
    reset
      ? 'Reset security settings?'
      : alwaysAllow
        ? 'Always allow these tools?'
        : 'Review permission changes',
    (Object.keys(after.tools).some(
      (name) => after.tools[name] === 'allow' && before.tools[name] !== 'allow'
    )
      ? 'WARNING: Always allow lets the assistant use the selected tools in any chat without asking again. It may read private information, type or delete text, click buttons, close apps, or send information through an app. Model mistakes can affect your work. Only enable tools you trust. You can change this in Settings > Permissions or press Stop at any time.\n\n'
      : '') +
      (after.research.enabled &&
      (!before.research.enabled || before.research.provider !== after.research.provider)
        ? 'Web access shares your private conversation context. Queries go to the selected search provider; page URLs go to public websites and may follow up to three public redirects. Queries and URLs may disclose conversation details. No browser cookies or logins are used. Tool permissions control approval for each search and page read.\n\n'
        : '') +
      (after.model.provider !== 'local' &&
      (before.model.provider !== after.model.provider ||
        before.model.endpoint !== after.model.endpoint)
        ? `Hosted inference sends conversation context, selected memories, attachments, screenshots and tool results included in a request to the selected model provider. ${after.model.provider === 'chatgpt' ? 'Usage counts toward your ChatGPT plan or credits.' : 'API usage may incur charges.'} Tool permissions still apply.\n\n`
        : '') +
      JSON.stringify({ before: controls(before), after: controls(after) }, null, 2),
    undefined,
    {
      confirmLabel: reset ? 'Reset settings' : alwaysAllow ? 'Always allow' : 'Save changes',
      summary: alwaysAllow
        ? 'Allow these tools in every chat without asking again. You can change this in Permissions at any time.'
        : 'Review what Sophon will be allowed to do. Changes apply across all chats. Cancel keeps your current settings.',
      changes
    }
  )
}
