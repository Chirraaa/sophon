/// <reference lib="dom" />

// Fixed host code evaluated in the page. Never accepts model-authored code.
// Return short display values and retain a full value only in host memory for
// identity checks; secret/file inputs are neither read nor actionable.
export type DomDescription = {
  role: string
  name: string
  value: string
  omittedValue: boolean
  enabled: boolean
  checked: boolean | string | null
  href: string
  actions: string[]
  options: { value: string; label: string }[]
}
export function describeElement(element: Element): DomDescription | null {
  const el = element as HTMLElement
  if (
    !el.isConnected ||
    el.closest('[hidden],[inert],[aria-hidden="true"],input[type="password"],input[type="file"]')
  )
    return null
  const rect = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none')
    return null
  const tag = el.tagName.toLowerCase()
  const input = el as HTMLInputElement
  const type = (input.type ?? '').toLowerCase()
  const role =
    el.getAttribute('role') ||
    ({
      button: 'button',
      a: 'link',
      textarea: 'textbox',
      select: 'combobox',
      input: ['checkbox', 'radio'].includes(type)
        ? type
        : ['button', 'submit', 'reset'].includes(type)
          ? 'button'
          : 'textbox'
    }[tag] ??
      tag)
  const labelIds = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
  const name = (
    el.getAttribute('aria-label') ||
    labelIds.map((id) => document.getElementById(id)?.textContent ?? '').join(' ') ||
    (input.labels
      ? Array.from(input.labels)
          .map((label) => label.textContent)
          .join(' ')
      : '') ||
    el.getAttribute('placeholder') ||
    el.innerText ||
    el.getAttribute('title') ||
    ''
  )
    .trim()
    .slice(0, 240)
  const editable =
    el.isContentEditable ||
    tag === 'textarea' ||
    (tag === 'input' && ['text', 'search', 'email', 'url', 'tel', 'number', ''].includes(type))
  const value =
    editable || tag === 'select' ? (el.isContentEditable ? el.innerText : input.value) : ''
  // Huge editors need a different route; never reconstruct a truncated value.
  if (value.length > 60000)
    return {
      role,
      name,
      value: '',
      omittedValue: true,
      enabled: false,
      checked: null,
      href: '',
      actions: [] as string[],
      options: [] as { value: string; label: string }[]
    }
  const enabled = !input.disabled && el.getAttribute('aria-disabled') !== 'true'
  const actions: string[] = []
  if (enabled) {
    if (['button', 'link', 'tab', 'menuitem', 'option', 'treeitem'].includes(role))
      actions.push('click')
    if (editable && !input.readOnly) actions.push('fill', 'press_enter')
    if (tag === 'input' && type === 'checkbox') actions.push('check', 'uncheck')
    if (tag === 'select') actions.push('select')
  }
  return {
    role,
    name,
    value,
    omittedValue: false,
    enabled,
    checked: type === 'checkbox' ? input.checked : el.getAttribute('aria-checked'),
    href: tag === 'a' ? (el as HTMLAnchorElement).href : '',
    actions,
    options:
      tag === 'select'
        ? Array.from((el as HTMLSelectElement).options)
            .slice(0, 30)
            .map((option) => ({
              value: option.value.slice(0, 240),
              label: option.label.slice(0, 240)
            }))
        : []
  }
}

export function visibleText(query: string): { text: string; truncated: boolean } {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  let chars = 0,
    visited = 0
  let node: Node | null
  while ((node = walker.nextNode()) && visited++ < 3000) {
    const parent = node.parentElement
    if (
      !parent ||
      parent.closest(
        'script,style,noscript,input,textarea,[contenteditable],[hidden],[inert],[aria-hidden="true"]'
      )
    )
      continue
    const style = getComputedStyle(parent)
    if (
      style.visibility === 'hidden' ||
      style.display === 'none' ||
      !parent.getClientRects().length
    )
      continue
    const text = (node.textContent ?? '').trim()
    if (!text || (query && !text.toLowerCase().includes(query.toLowerCase()))) continue
    parts.push(text.slice(0, 400))
    chars += Math.min(text.length, 400)
    if (chars >= 2400) break
  }
  return { text: parts.join('\n').slice(0, 2400), truncated: Boolean(node) }
}
