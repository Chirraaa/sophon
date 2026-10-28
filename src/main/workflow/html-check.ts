import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import { Script } from 'node:vm'

// Parse and compile only: generated scripts are never executed in the main process.
export function standaloneHtmlIssue(source: unknown): string | undefined {
  if (typeof source !== 'string' || source.length > 60000)
    return 'A complete HTML document of at most 60,000 characters is required for the built-in check.'
  if (!/^\s*<!doctype html>/i.test(source) || !/<\/html>\s*$/i.test(source))
    return 'The standalone HTML document is incomplete: include its HTML5 doctype and closing html tag.'
  const errors: string[] = []
  const document = parse(source, {
    onParseError: (error) => errors.push(`${error.code} at line ${error.startLine}`)
  })
  if (errors.length) return 'HTML parse error: ' + errors[0]
  const visit = (node: DefaultTreeAdapterTypes.Node): string | undefined => {
    if ('tagName' in node) {
      const attr = (name: string): string | undefined =>
        node.attrs.find((item) => item.name === name)?.value
      if (node.tagName === 'script') {
        if (attr('src') !== undefined)
          return 'Linked scripts need a project check command; the built-in standalone check covers inline scripts only.'
        const type = (attr('type') ?? '').toLowerCase()
        if (type === 'module')
          return 'Module scripts need a project check command; the built-in standalone check covers classic scripts only.'
        if (!type || ['text/javascript', 'application/javascript'].includes(type)) {
          const code = node.childNodes
            .filter((child) => child.nodeName === '#text')
            .map((child) => (child as DefaultTreeAdapterTypes.TextNode).value)
            .join('')
          try {
            new Script(code, { filename: 'inline-script.js' })
          } catch (error) {
            return 'JavaScript syntax error: ' + (error as Error).message.slice(0, 500)
          }
        }
      }
    }
    if ('childNodes' in node)
      for (const child of node.childNodes) {
        const issue = visit(child)
        if (issue) return issue
      }
    return undefined
  }
  return visit(document)
}
