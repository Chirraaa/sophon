import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { GithubForm } from './GithubFeedback'
import { object, label, rows, type Row } from './data'

export function GithubPullRequestPanel({
  owner,
  repo,
  branch,
  base,
  setBase,
  selectedPr,
  comments,
  setComments,
  perform,
  call,
  setNotice,
  reload
}: {
  owner: string
  repo: string
  branch: string
  base: string
  setBase: (base: string) => void
  selectedPr: number | null
  comments: Row[]
  setComments: (comments: Row[]) => void
  perform: (action: () => Promise<void>) => Promise<void>
  call: (tool: string, args?: Row) => Promise<unknown>
  setNotice: (notice: string) => void
  reload: () => Promise<void>
}): React.JSX.Element {
  const [comment, setComment] = useState('')
  const [title, setTitle] = useState('')
  return (
    <>
      {selectedPr !== null && (
        <div className="space-y-3 rounded-lg bg-muted/30 p-4">
          <h3 className="text-sm font-medium">Comments on #{selectedPr} · first page (up to 20)</h3>
          {comments.map((c, i) => (
            <div key={String(c.id ?? i)} className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">{label(object(c.user).login)}</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">{label(c.body)}</p>
            </div>
          ))}
          {!comments.length && <p className="text-sm text-muted-foreground">No comments yet.</p>}
          <GithubForm
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              void perform(async () => {
                await call('add_issue_comment', {
                  owner,
                  repo,
                  issue_number: selectedPr,
                  body: comment
                })
                setComment('')
                setComments(
                  rows(
                    await call('pull_request_read', {
                      method: 'get_comments',
                      owner,
                      repo,
                      pullNumber: selectedPr,
                      perPage: 20
                    })
                  )
                )
                setNotice('Comment posted.')
              })
            }}
          >
            <Textarea
              aria-label="Comment"
              placeholder="Leave a comment…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              required
              maxLength={12000}
            />
            <Button type="submit" size="sm">
              Post comment
            </Button>
          </GithubForm>
        </div>
      )}
      <GithubForm
        className="space-y-3 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault()
          void perform(async () => {
            await call('create_pull_request', {
              owner,
              repo,
              head: branch,
              base,
              title
            })
            setTitle('')
            setNotice('Pull request created.')
            await reload()
          })
        }}
      >
        <h3 className="text-sm font-medium">Open a pull request</h3>
        <Input
          aria-label="Pull request title"
          placeholder="Pull request title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <Input
          aria-label="Base branch"
          placeholder="Base branch, e.g. main"
          value={base}
          onChange={(e) => setBase(e.target.value)}
          required
        />
        <Button type="submit" variant="outline" disabled={!branch || branch === base}>
          Create pull request from {branch || 'selected branch'}
        </Button>
      </GithubForm>
    </>
  )
}
