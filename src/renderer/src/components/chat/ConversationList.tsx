import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from '@/components/ui/select'
import { useState } from 'react'
import {
  MessageSquare,
  Pencil,
  Plus,
  FolderPlus,
  Folder,
  FolderInput,
  ChevronRight,
  X,
  ArrowUp,
  ArrowDown
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DeleteChatPopover } from './DeleteChatPopover'
import { cn } from '@/lib/utils'
import { useSession } from '@/hooks/useSession'
export function ConversationList({ onSelect }: { onSelect: () => void }): React.JSX.Element {
  const { chats, chatId, runningChatId, categories = [] } = useSession()
  const [editing, setEditing] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [categoryEditor, setCategoryEditor] = useState<string | null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [closed, setClosed] = useState<string[]>([])
  const [moving, setMoving] = useState<string | null>(null)
  const [dragged, setDragged] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const run = (action: Promise<void>): void => {
    setError(null)
    void action.catch((error: Error) => setError(error.message))
  }
  const move = (
    id: string,
    categoryId: string | null,
    beforeId: string | null = null
  ): Promise<void> => {
    setNotice('')
    return window.api.chats.move(id, categoryId, beforeId).then(() => {
      setNotice(`Moved ${chats.find((chat) => chat.id === id)?.title ?? 'chat'}.`)
    })
  }
  const rename = (id: string): void => {
    if (title.trim()) run(window.api.chats.rename(id, title))
    setEditing(null)
  }
  const commitCategory = (): void => {
    if (!categoryName.trim()) return
    const action =
      categoryEditor === 'new'
        ? window.api.chats.createCategory(categoryName)
        : window.api.chats.renameCategory(categoryEditor!, categoryName)
    setError(null)
    void action
      .then(() => {
        setCategoryEditor(null)
        setCategoryName('')
      })
      .catch((error: Error) => setError(error.message))
  }
  const drop = (
    event: React.DragEvent,
    categoryId: string | null,
    beforeId: string | null = null
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    const id = dragged || event.dataTransfer.getData('application/x-sophon-chat')
    if (id && chats.some((chat) => chat.id === id)) run(move(id, categoryId, beforeId))
    setDragged(null)
    setDropTarget(null)
    if (categoryId) setClosed((current) => current.filter((id) => id !== categoryId))
  }
  const groups = [
    { id: null, name: categories.length ? 'Uncategorized' : 'All chats' },
    ...categories
  ]
  return (
    <div className="mt-6 flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between px-3">
        <span className="text-xs font-medium tracking-[0.12em] text-muted-foreground">CHATS</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="New category"
            title="New category"
            onClick={() => {
              setCategoryEditor('new')
              setCategoryName('')
            }}
          >
            <FolderPlus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="New chat"
            onClick={() => {
              run(window.api.chats.create())
              onSelect()
            }}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>
      {categoryEditor && (
        <div className="mb-2 rounded-lg border border-border p-2">
          <Input
            autoFocus
            aria-label={categoryEditor === 'new' ? 'Category name' : 'Rename category'}
            placeholder="Category name"
            maxLength={60}
            value={categoryName}
            onChange={(event) => setCategoryName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitCategory()
              if (event.key === 'Escape') setCategoryEditor(null)
            }}
            className="h-8 text-xs"
          />
          <div className="mt-2 flex gap-1">
            <Button
              size="sm"
              className="h-7 text-[10px]"
              disabled={!categoryName.trim()}
              onClick={commitCategory}
            >
              {categoryEditor === 'new' ? 'Add category' : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[10px]"
              onClick={() => setCategoryEditor(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        {groups.map((category) => {
          const members = chats.filter((chat) => (chat.categoryId ?? null) === category.id)
          const key = category.id ?? 'uncategorized'
          const open = !closed.includes(key)
          return (
            <section
              key={key}
              className="mb-2"
              aria-label={category.name}
              onDragOver={(event) => {
                if (dragged) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropTarget(key)
                }
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setDropTarget(null)
              }}
              onDrop={(event) => drop(event, category.id)}
            >
              <div
                className={cn(
                  'group flex items-center rounded-lg',
                  dropTarget === key && 'bg-tint/15 ring-1 ring-tint'
                )}
              >
                <Button
                  variant="ghost"
                  type="button"
                  aria-expanded={open}
                  aria-label={`${open ? 'Collapse' : 'Expand'} ${category.name}`}
                  onClick={() =>
                    setClosed((current) =>
                      open ? [...current, key] : current.filter((id) => id !== key)
                    )
                  }
                  className="flex h-auto min-w-0 flex-1 items-center justify-start gap-1.5 px-2 py-2 text-left text-[10px] text-muted-foreground"
                >
                  <ChevronRight
                    className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
                  />
                  <Folder className="size-3 shrink-0" />
                  <span className="truncate">{category.name}</span>
                  <span className="ml-auto tabular-nums">{members.length}</span>
                </Button>
                {category.id && (
                  <div className="flex shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Rename category ${category.name}`}
                      onClick={() => {
                        setCategoryEditor(category.id)
                        setCategoryName(category.name)
                      }}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove category ${category.name}`}
                      title="Remove category; keep its chats"
                      onClick={() => run(window.api.chats.deleteCategory(category.id!))}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                )}
              </div>
              {open && members.length === 0 && (
                <p className="px-4 py-2 text-[10px] text-muted-foreground">Drop chats here</p>
              )}
              {open &&
                members.map((chat, index) => (
                  <div key={chat.id}>
                    <div
                      draggable={editing !== chat.id}
                      onDragStart={(event) => {
                        setDragged(chat.id)
                        event.dataTransfer.setData('application/x-sophon-chat', chat.id)
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={() => {
                        setDragged(null)
                        setDropTarget(null)
                      }}
                      onDragOver={(event) => {
                        if (dragged && dragged !== chat.id) {
                          event.preventDefault()
                          event.stopPropagation()
                          setDropTarget(chat.id)
                        }
                      }}
                      onDrop={(event) => drop(event, category.id, chat.id)}
                      className={cn(
                        'group relative flex min-w-0 items-center rounded-lg',
                        chat.id === chatId && 'bg-muted/40',
                        dragged === chat.id && 'opacity-40',
                        dropTarget === chat.id && 'border-t-2 border-tint'
                      )}
                    >
                      {editing === chat.id ? (
                        <Input
                          autoFocus
                          value={title}
                          aria-label="Chat title"
                          onChange={(event) => setTitle(event.target.value)}
                          onBlur={() => rename(chat.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') rename(chat.id)
                            if (event.key === 'Escape') setEditing(null)
                          }}
                          className="m-1 h-8 text-xs"
                        />
                      ) : (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            run(window.api.chats.select(chat.id))
                            onSelect()
                          }}
                          className="h-9 min-w-0 flex-1 justify-start gap-2 px-3 text-xs font-normal text-muted-foreground group-hover:pr-20 group-focus-within:pr-20"
                        >
                          <MessageSquare
                            className={cn(
                              'size-3 shrink-0',
                              runningChatId === chat.id && 'animate-pulse text-tint'
                            )}
                          />
                          <span className="truncate">{chat.title}</span>
                        </Button>
                      )}
                      {editing !== chat.id && (
                        <div className="pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 rounded-md bg-card opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Organize ${chat.title}`}
                            onClick={() => setMoving(moving === chat.id ? null : chat.id)}
                          >
                            <FolderInput className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={'Rename ' + chat.title}
                            onClick={() => {
                              setTitle(chat.title)
                              setEditing(chat.id)
                            }}
                          >
                            <Pencil className="size-3" />
                          </Button>
                          <DeleteChatPopover
                            id={chat.id}
                            title={chat.title}
                            disabled={runningChatId === chat.id}
                          />
                        </div>
                      )}
                    </div>
                    {moving === chat.id && (
                      <div className="mx-1 mb-2 rounded-lg border border-border bg-card p-2">
                        <label className="block text-[10px] text-muted-foreground">
                          Move to category
                          <Select
                            value={chat.categoryId ?? ''}
                            items={[
                              { value: '', label: 'Uncategorized' },
                              ...categories.map((category) => ({
                                value: category.id,
                                label: category.name
                              }))
                            ]}
                            onValueChange={(value) => {
                              run(move(chat.id, value || null))
                              setMoving(null)
                            }}
                          >
                            <SelectTrigger
                              size="sm"
                              aria-label={`Category for ${chat.title}`}
                              className="mt-1 w-full text-xs"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">Uncategorized</SelectItem>
                              {categories.map((category) => (
                                <SelectItem key={category.id} value={category.id}>
                                  {category.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                        <div className="mt-2 flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Move ${chat.title} up`}
                            disabled={index === 0}
                            onClick={() => run(move(chat.id, category.id, members[index - 1].id))}
                          >
                            <ArrowUp className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Move ${chat.title} down`}
                            disabled={index === members.length - 1}
                            onClick={() =>
                              run(move(chat.id, category.id, members[index + 2]?.id ?? null))
                            }
                          >
                            <ArrowDown className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ml-auto h-6 text-[10px]"
                            onClick={() => setMoving(null)}
                          >
                            Done
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
            </section>
          )
        })}
      </ScrollArea>
      <p role="status" className="sr-only">
        {notice}
      </p>
      {error && (
        <p role="alert" className="px-3 py-2 text-[10px] text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
