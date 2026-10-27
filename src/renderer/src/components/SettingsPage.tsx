import { Check } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { BehaviorTab } from './settings/BehaviorTab'
import { GeneralTab } from './settings/GeneralTab'
import { ModelTab } from './settings/ModelTab'
import { PermissionsTab } from './settings/PermissionsTab'
import { VoiceTab } from './settings/VoiceTab'
import { FilesTab } from './settings/FilesTab'
import { HardwareTab } from './settings/HardwareTab'
import { MemoryTab } from './settings/MemoryTab'
import { PluginsTab } from './settings/PluginsTab'
import { ProfileTab } from './settings/ProfileTab'
import { useSettingsSave } from './settings/save'
export type TabId =
  | 'profile'
  | 'general'
  | 'model'
  | 'behavior'
  | 'memory'
  | 'permissions'
  | 'voice'
  | 'files'
  | 'hardware'
  | 'plugins'
const TABS = [
  {
    id: 'profile',
    label: 'Profile',
    title: 'A little about you.',
    description: 'Your name, goals and preferred guidance. Update them whenever things change.',
    component: ProfileTab
  },
  {
    id: 'general',
    label: 'General',
    title: 'Make yourself at home.',
    description: 'The little details that make Sophon feel like yours.',
    component: GeneralTab
  },
  {
    id: 'model',
    label: 'Model',
    title: 'A mind of your choosing.',
    description: 'Connect your model and find the right balance for your workflow.',
    component: ModelTab
  },
  {
    id: 'behavior',
    label: 'Behavior',
    title: 'Help, your way.',
    description: 'A few preferences for how your assistant responds.',
    component: BehaviorTab
  },
  {
    id: 'permissions',
    label: 'Permissions',
    title: 'You’re in control.',
    description: 'Choose what Sophon can do and when it should ask.',
    component: PermissionsTab
  },
  {
    id: 'memory',
    label: 'Memory',
    title: 'Remember what matters.',
    description: 'Teach useful context once, then recall it when it helps.',
    component: MemoryTab
  },
  {
    id: 'voice',
    label: 'Voice',
    title: 'Just say the word.',
    description: 'Natural commands, transcribed right on your computer.',
    component: VoiceTab
  },
  {
    id: 'files',
    label: 'Files',
    title: 'A place to work.',
    description: 'Choose the folder Sophon can work with.',
    component: FilesTab
  },
  {
    id: 'plugins',
    label: 'Plugins',
    title: 'Connect your tools.',
    description: 'Bring your skills, apps and MCP servers into Sophon.',
    component: PluginsTab
  },
  {
    id: 'hardware',
    label: 'Hardware',
    title: 'Meet your machine.',
    description: 'Your computer and connected displays at a glance.',
    component: HardwareTab
  }
] as const
export function SettingsPage({
  settings,
  tab,
  onTab
}: {
  settings: AppSettings | null
  tab: TabId
  onTab: (tab: TabId) => void
}): React.JSX.Element {
  const saving = useSettingsSave()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-white/5 px-7">
        <h1 className="text-[13px] font-medium">Settings</h1>
        <span role="status" className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Check className="size-3" />{' '}
          {saving.pending > 0
            ? 'Saving settings…'
            : saving.error
              ? 'Settings change was not saved'
              : tab === 'plugins'
                ? 'Manage connections explicitly'
                : tab === 'profile'
                  ? 'Save your profile when ready'
                  : tab === 'memory'
                    ? 'Save each memory explicitly'
                    : 'Changes save automatically'}
        </span>
      </header>
      {saving.error && (
        <p role="alert" className="border-b border-border px-7 py-3 text-xs text-destructive">
          {saving.error}
        </p>
      )}
      <Tabs
        value={tab}
        onValueChange={(value) => onTab(value as TabId)}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="shrink-0 px-7 pt-4 pb-4">
          <TabsList
            aria-label="Settings categories"
            className="grid w-full grid-cols-5 gap-1 rounded-xl border border-border bg-muted/40 p-1 group-data-horizontal/tabs:h-auto min-[1100px]:grid-cols-10"
          >
            {TABS.map(({ id, label }) => (
              <TabsTrigger
                key={id}
                value={id}
                className="h-8 rounded-lg px-2 text-[11px] font-normal data-active:bg-white/10 data-active:shadow-sm dark:data-active:bg-white/10"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <ScrollArea key={tab} className="min-h-0 flex-1">
          <div className="mx-auto max-w-[800px] px-7 pb-8">
            {TABS.map(({ id, title, description, component: Component }) => (
              <TabsContent key={id} value={id} className="settings-content">
                <div className="mb-5 pt-1">
                  <h2 className="text-xl font-medium tracking-tight">{title}</h2>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </div>
                {settings === null ? (
                  <div aria-label="Loading settings" aria-busy="true" className="space-y-4">
                    <Skeleton className="h-32 rounded-2xl" />
                    <Skeleton className="h-48 rounded-2xl" />
                  </div>
                ) : (
                  tab === id && <Component settings={settings} />
                )}
              </TabsContent>
            ))}
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  )
}
