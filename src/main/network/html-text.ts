import { parse, type DefaultTreeAdapterTypes } from 'parse5'

type Node = DefaultTreeAdapterTypes.Node
const OMIT = new Set(['script', 'style', 'noscript', 'template', 'svg'])
function children(node: Node): Node[] {
  return 'childNodes' in node ? node.childNodes : []
}
function omitted(node: Node): boolean {
  return 'tagName' in node && OMIT.has(node.tagName)
}
function textOf(node: Node): string {
  const parts: string[] = []
  const stack = [node]
  while (stack.length) {
    const current = stack.pop()!
    if (omitted(current)) continue
    if ('value' in current && current.nodeName === '#text') parts.push(current.value)
    const nested = children(current)
    for (let i = nested.length - 1; i >= 0; i--) stack.push(nested[i])
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export function extractWebHtml(html: string): {
  text: string
  title: string
  links: { title: string; href: string }[]
  results: { title: string; href: string; description: string }[]
} {
  const document = parse(html)
  const links: { title: string; href: string }[] = []
  const results: { title: string; href: string; description: string }[] = []
  let title = ''
  const stack: Node[] = [document]
  while (stack.length) {
    const node = stack.pop()!
    if (omitted(node)) continue
    if ('tagName' in node) {
      const attribute = (name: string): string =>
        node.attrs.find((a) => a.name === name)?.value ?? ''
      const classes = attribute('class').split(/\s+/)
      if (node.tagName === 'title' && !title) title = textOf(node).slice(0, 300)
      if (node.tagName === 'a' && attribute('href')) {
        if (links.length < 100)
          links.push({ title: textOf(node).slice(0, 120), href: attribute('href') })
        if (classes.includes('result__a') && results.length < 20)
          results.push({
            title: textOf(node).slice(0, 300),
            href: attribute('href'),
            description: ''
          })
      }
      if (classes.includes('result__snippet') && results.length)
        results[results.length - 1].description = textOf(node).slice(0, 3000)
    }
    const nested = children(node)
    for (let i = nested.length - 1; i >= 0; i--) stack.push(nested[i])
  }
  return { text: textOf(document), title, links, results }
}
