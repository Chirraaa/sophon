import { useState } from 'react'
import { Plus, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { GithubForm } from './GithubFeedback'
import type { Row } from './data'

export function GithubPushForm({
  owner,
  repo,
  repository,
  branch,
  perform,
  call,
  setNotice
}: {
  owner: string
  repo: string
  repository: string
  branch: string
  perform: (action: () => Promise<void>) => Promise<void>
  call: (tool: string, args?: Row) => Promise<unknown>
  setNotice: (notice: string) => void
}): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState([{ path: '', content: '' }])
  return (
    <GithubForm
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void perform(async () => {
          const paths = files.map((f) => f.path.trim())
          if (
            new Set(paths).size !== paths.length ||
            paths.some((p) => p.startsWith('/') || p.split('/').includes('..'))
          )
            throw new Error('Use unique repository-relative file paths.')
          await call('push_files', {
            owner,
            repo,
            branch,
            message,
            files: files.map((f) => ({ ...f, path: f.path.trim() }))
          })
          setMessage('')
          setFiles([{ path: '', content: '' }])
          setNotice(`Commit pushed to ${repository}:${branch}.`)
        })
      }}
    >
      <p className="text-sm text-muted-foreground">
        Create or replace text files on GitHub in one commit. Review the contents and selected
        branch below before publishing.
      </p>
      {files.map((file, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label={`File ${i + 1} path`}
              placeholder="src/example.ts"
              value={file.path}
              onChange={(e) =>
                setFiles(files.map((f, n) => (n === i ? { ...f, path: e.target.value } : f)))
              }
              required
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove file ${i + 1}`}
              disabled={files.length === 1}
              onClick={() => setFiles(files.filter((_, n) => n !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          <Textarea
            className="min-h-40 font-mono text-xs"
            aria-label={`File ${i + 1} contents`}
            placeholder="Full file contents"
            value={file.content}
            onChange={(e) =>
              setFiles(files.map((f, n) => (n === i ? { ...f, content: e.target.value } : f)))
            }
            maxLength={24000}
          />
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        type="button"
        disabled={files.length >= 10}
        onClick={() => setFiles([...files, { path: '', content: '' }])}
      >
        <Plus className="size-4" />
        Add file
      </Button>
      <Input
        aria-label="Commit message"
        placeholder="Commit message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        required
        maxLength={1000}
      />
      <Button type="submit" disabled={!branch}>
        <Upload className="size-4" />
        Commit & push to {branch || 'a branch'}
      </Button>
    </GithubForm>
  )
}
