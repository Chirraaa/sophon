import { useEffect, useState } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { ChatView } from '@/components/ChatView'
import { SettingsPage, type TabId } from '@/components/SettingsPage'
import { Sidebar, type View } from '@/components/Sidebar'
import { GithubWorkspace } from '@/components/github/GithubWorkspace'
import { Onboarding } from '@/components/Onboarding'
import { AppUpdates } from '@/components/AppUpdates'
export default function App(): React.JSX.Element {
  const settings = useSettings()
  const [view, setView] = useState<View>('chat')
  const [settingsTab, setSettingsTab] = useState<TabId>('general')
  const connection = JSON.stringify([
    settings?.model.provider,
    settings?.model.endpoint,
    settings?.model.modelId
  ])
  const [connectionState, setConnectionState] = useState<{
    connection: string
    status: LlmStatus
    planConnected: boolean
  } | null>(null)
  const status = connectionState?.connection === connection ? connectionState.status : null
  const planConnected = connectionState?.connection === connection && connectionState.planConnected
  useEffect(() => {
    let alive = true
    const poll = async (): Promise<void> => {
      try {
        const [next, account] = await Promise.all([
          window.api.llmStatus(),
          settings?.model.provider === 'chatgpt'
            ? window.api.chatgpt.status()
            : Promise.resolve(null)
        ])
        if (alive) {
          setConnectionState({
            connection,
            status: next,
            planConnected: Boolean(
              account?.accounts.find((item) => item.id === account.activeId)?.planEnabled
            )
          })
        }
      } catch {
        if (alive)
          setConnectionState({ connection, status: { online: false }, planConnected: false })
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [connection, settings?.model.provider])
  const openModel = (): void => {
    setSettingsTab('model')
    setView('settings')
  }
  return (
    <div className="app-shell flex h-dvh flex-col overflow-hidden text-foreground">
      {settings && !settings.profile.onboardingComplete && <Onboarding settings={settings} />}
      <header className="drag flex h-10 shrink-0 items-center px-5 pr-36">
        <span className="text-xs font-medium tracking-[0.02em] text-muted-foreground">Sophon</span>
      </header>
      <AppUpdates canShowNotes={Boolean(settings?.profile.onboardingComplete)} />
      <div className="flex min-h-0 flex-1 gap-2 px-3 pb-3">
        <Sidebar
          view={view}
          onView={setView}
          status={status}
          hotkey={settings?.hotkeys.summon}
          onOpenModel={openModel}
        />
        <main className="workspace min-w-0 flex-1 overflow-hidden rounded-[22px]">
          <div key={view} className="view-content h-full">
            {view === 'chat' ? (
              <ChatView
                status={status}
                onOpenModel={openModel}
                usingChatgpt={settings?.model.provider === 'chatgpt' && planConnected}
              />
            ) : view === 'github' ? (
              <GithubWorkspace />
            ) : (
              <SettingsPage settings={settings} tab={settingsTab} onTab={setSettingsTab} />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
