import './assets/main.css'
import { StrictMode } from 'react'
import { MotionProvider } from './components/MotionProvider'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from './components/ui/tooltip'
import App from './App'
import CompactApp from './CompactApp'
import { VoiceCapture } from './components/VoiceCapture'
import { PermissionReview } from './components/PermissionReview'
import { MicrophonesProvider } from './components/MicrophonesProvider'
import { TextContextMenu } from './components/TextContextMenu'
import { UpdatesProvider } from './components/UpdatesProvider'
const isCompact = window.location.hash === '#/compact'
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionProvider>
      <TooltipProvider delay={400}>
        <TextContextMenu>
          <VoiceCapture />
          {isCompact ? (
            <CompactApp />
          ) : (
            <MicrophonesProvider>
              <UpdatesProvider>
                <App />
              </UpdatesProvider>
            </MicrophonesProvider>
          )}
          <PermissionReview />
        </TextContextMenu>
      </TooltipProvider>
    </MotionProvider>
  </StrictMode>
)
