import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ProfileEditor } from './settings/ProfileTab'

export function Onboarding({ settings }: { settings: AppSettings }): React.JSX.Element {
  return (
    <Dialog open={!settings.profile.onboardingComplete}>
      <DialogContent showCloseButton={false} className="max-w-lg gap-5">
        <div className="space-y-2">
          <DialogTitle className="text-xl font-medium tracking-tight">
            Welcome to Sophon
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Let’s make this space feel like yours.
          </DialogDescription>
        </div>
        <ScrollArea className="min-h-0" contentClassName="pr-2 pb-1">
          <ProfileEditor settings={settings} onboarding />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
