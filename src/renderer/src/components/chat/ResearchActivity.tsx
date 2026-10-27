import { Spinner } from '@/components/ui/spinner'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { ChevronRight, Globe } from 'lucide-react'
import { PageLink } from './PageLink'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Hint } from '../ui/tooltip'

function SiteIcon({ domain }: { domain: string }): React.JSX.Element {
  return (
    <Hint text={domain}>
      <Avatar className="size-6 border-2 border-background bg-muted">
        <AvatarImage
          src={`sophon-app://app/favicon/${encodeURIComponent(domain)}`}
          alt=""
          className="size-4 object-contain"
          referrerPolicy="no-referrer"
        />
        <AvatarFallback className="text-[10px] font-semibold uppercase text-foreground">
          {domain[0]}
        </AvatarFallback>
      </Avatar>
    </Hint>
  )
}

export function ResearchActivity({ item }: { item: ChatItem }): React.JSX.Element | null {
  const actions = item.actions.filter((action) => ['web_search', 'web_fetch'].includes(action.name))
  if (!actions.length && !item.sources?.length) return null
  const active = actions.findLast((action) => ['running', 'waiting'].includes(action.status))
  const sites = new Map<string, ResearchSource>()
  for (const source of item.sources ?? []) {
    try {
      const url = new URL(source.url)
      if (url.protocol === 'https:') sites.set(url.hostname.replace(/^www\./, ''), source)
    } catch {
      /* Ignore malformed source URLs. */
    }
  }
  const domains = [...sites.keys()]
  const label =
    active?.status === 'waiting'
      ? 'Waiting for web access'
      : active?.name === 'web_fetch'
        ? 'Reading a website'
        : active
          ? 'Searching the web'
          : domains.length
            ? `Found ${domains.length} ${domains.length === 1 ? 'website' : 'websites'}`
            : actions.some((action) => action.status === 'failed')
              ? 'Web search stopped'
              : 'Web search complete'
  return (
    <Collapsible className="group w-full rounded-xl border border-border bg-muted/20 text-xs text-muted-foreground">
      <CollapsibleTrigger showIndicator={false} className="w-full flex-wrap px-3 py-2.5">
        {active?.status === 'running' ? (
          <Spinner className="size-3.5" aria-hidden="true" />
        ) : (
          <Globe className="size-3.5" aria-hidden="true" />
        )}
        <span role="status">{label}</span>
        {!!domains.length && (
          <span className="flex -space-x-1" aria-label={domains.join(', ')}>
            {domains.slice(0, 5).map((domain) => (
              <SiteIcon key={domain} domain={domain} />
            ))}
            {domains.length > 5 && (
              <span className="flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[9px]">
                +{domains.length - 5}
              </span>
            )}
          </span>
        )}
        {active && !!domains.length && <span>{domains.length} websites found</span>}
        <ChevronRight
          className="ml-auto size-3.5 transition-transform group-aria-expanded/collapsible-trigger:rotate-90"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 border-t border-border px-3 py-3">
          {sites.size ? (
            [...sites].map(([domain, source]) => (
              <div key={domain}>
                <PageLink url={source.url}>{source.title || domain}</PageLink>
                <p className="mt-0.5 truncate text-[11px]">{domain}</p>
              </div>
            ))
          ) : (
            <p>{active ? 'Sources will appear as results arrive.' : 'No websites returned.'}</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
