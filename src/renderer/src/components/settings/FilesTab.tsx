import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Notice, PillButton, Row, Section } from './controls'
export function FilesTab({ settings }: { settings: AppSettings }): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="space-y-4">
      <Section
        title="Working folder"
        description="Choose a project folder to read, create and replace source files and create subfolders. Sensitive paths and linked entries remain protected. npm commands require approval and run with your Windows account permissions."
      >
        <Row label="Folder access" stack>
          <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/10 p-3">
            <FolderOpen className="size-5 shrink-0 text-muted-foreground" />
            <span className="selectable min-w-0 flex-1 break-all text-xs text-muted-foreground">
              {settings.files.workspace || 'No working folder selected'}
            </span>
          </div>
          <div className="mt-3 flex gap-2">
            <PillButton
              onClick={() => {
                setError(null)
                void window.api.pickWorkspace().catch((error: Error) => setError(error.message))
              }}
            >
              Choose folder
            </PillButton>
            {settings.files.workspace && (
              <PillButton
                onClick={() => {
                  setError(null)
                  void window.api.removeWorkspace().catch((error: Error) => setError(error.message))
                }}
              >
                Remove access
              </PillButton>
            )}
          </div>
        </Row>
      </Section>
      <Notice>
        Choose Auto or Ask before edit in the composer. Auto creates folders and edits files without
        repeated prompts; blocked tools stay blocked. Commands and deletions always need one-use
        approval. Files you attach manually are shared with the selected model provider for that
        message. Public research cannot read this folder or include attachments.
      </Notice>
      {error && <Notice tone="warn">{error}</Notice>}
    </div>
  )
}
