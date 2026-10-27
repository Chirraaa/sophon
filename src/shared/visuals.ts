export const VISUAL_FENCE = /(?:^|\n)\s*(?:`{3,}|~{3,})\s*(?:html|svg|mermaid|visualization)\b/i

export function visualKind(
  language: string | undefined,
  source: string
): 'diagram' | 'interactive' | undefined {
  const name = language?.toLowerCase()
  if (name === 'mermaid') return 'diagram'
  if (
    ['html', 'svg', 'visualization'].includes(name ?? '') ||
    (name === 'xml' && /^<svg[\s>]/i.test(source.trim()))
  )
    return 'interactive'
  return undefined
}
export const VISUAL_REQUEST =
  /\b(diagrams?|charts?|graphs?|plots?|visuali[sz](?:ation|e|ations)|widgets?|sliders?|dashboards?|flowcharts?|infographics?|interactive|illustrat\w*|draw|sketch|mockups?|mermaid|html|svg|graphiques?|diagrammes?|sch[ée]mas?|dessin\w*|interactif\w*|visualisation\w*|zeichnen|schaubild|diagramm\w*)\b/i
