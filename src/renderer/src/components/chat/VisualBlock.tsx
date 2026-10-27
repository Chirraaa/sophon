import { Children, isValidElement, useContext, type ReactNode } from 'react'
import { useVisualFollowUp, StreamingReply } from '@/hooks/useVisualFollowUp'
import { Diagram } from './Diagram'
import { InteractiveVisual } from './InteractiveVisual'
import { CodeBlock } from './CodeBlock'
import { VisualLoading } from './VisualLoading'
import { visualKind } from '../../../../shared/visuals'

function textContent(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? textContent(child.props.children)
        : String(child)
    )
    .join('')
}

export function VisualBlock({ children }: { children?: ReactNode }): React.JSX.Element {
  const onAsk = useVisualFollowUp()
  const streaming = useContext(StreamingReply)
  if (isValidElement<{ className?: string; children?: ReactNode }>(children)) {
    const language = children.props.className?.match(/language-([^\s]+)/i)?.[1].toLowerCase()
    const raw = textContent(children.props.children)
    const source = raw.trim()
    const kind = visualKind(language, source)
    if (kind && streaming) return <VisualLoading />
    if (kind === 'diagram') return <Diagram key={source} source={source} onAsk={onAsk} />
    if (kind === 'interactive')
      return <InteractiveVisual key={source} source={source} onAsk={onAsk} />
    return (
      <CodeBlock source={raw} language={language}>
        {children}
      </CodeBlock>
    )
  }
  return <CodeBlock source={textContent(children)}>{children}</CodeBlock>
}
