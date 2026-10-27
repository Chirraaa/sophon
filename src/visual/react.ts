import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = React.createElement
type Children = { children?: React.ReactNode }
type ChartOptions = {
  labels: Array<string | number>
  series: Array<{ name: string; values: number[]; color?: string; dashed?: boolean }>
  xLabel?: string
  yLabel?: string
  currency?: string
}
type FlowNode = { label: string; description?: string; question?: string; color?: string }
type Control = {
  id: string
  label: string
  min: number
  max: number
  value: number
  step?: number
  prefix?: string
  suffix?: string
}
type ExplorerOptions = {
  controls: Control[]
  calculate: (values: Record<string, number>) => {
    metrics: Array<{ label: string; value: number; currency?: string }>
    chart?: ChartOptions
  }
}
type Chart = { update: (options: ChartOptions) => void; destroy: () => void }
const host = window as unknown as {
  React: typeof React
  sophon: {
    lineChart: (target: HTMLElement, options: ChartOptions) => Chart
    flow: (target: HTMLElement, nodes: FlowNode[]) => void
    explorer: (target: HTMLElement, options: ExplorerOptions) => { destroy: () => void }
    followUp: (question: string) => void
    h?: typeof h
    ui?: object
    mount?: typeof mount
  }
}

function Stack({ children }: Children): React.ReactElement {
  return h('div', { className: 'sophon-stack' }, children)
}
function Grid({ children }: Children): React.ReactElement {
  return h('div', { className: 'sophon-grid' }, children)
}
function Card({ children }: Children): React.ReactElement {
  return h('section', { className: 'sophon-card' }, children)
}
function Heading({ title, subtitle }: { title: string; subtitle?: string }): React.ReactElement {
  return h(
    'header',
    { className: 'sophon-heading' },
    h('h2', null, title),
    subtitle && h('p', { className: 'sophon-muted' }, subtitle)
  )
}
function Text({ children }: Children): React.ReactElement {
  return h('p', { className: 'sophon-muted' }, children)
}
function Metric({
  label,
  value,
  currency
}: {
  label: string
  value: number | string
  currency?: string
}): React.ReactElement {
  const formatted =
    typeof value === 'number'
      ? new Intl.NumberFormat(
          'en-US',
          currency ? { style: 'currency', currency } : { maximumFractionDigits: 2 }
        ).format(value)
      : value
  return h(
    'div',
    { className: 'sophon-metric' },
    h('span', null, label),
    h('output', null, formatted)
  )
}
function Button({
  children,
  onClick,
  disabled = false
}: Children & { onClick?: () => void; disabled?: boolean }): React.ReactElement {
  return h('button', { type: 'button', onClick, disabled }, children)
}
function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  prefix = '',
  suffix = '',
  onChange
}: Omit<Control, 'id'> & { onChange: (value: number) => void }): React.ReactElement {
  const id = React.useId()
  return h(
    'div',
    { className: 'sophon-control' },
    h('label', { htmlFor: id }, label, h('output', { htmlFor: id }, prefix + value + suffix)),
    h('input', {
      id,
      type: 'range',
      min,
      max,
      step,
      value,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))
    })
  )
}
type Choice = { value: string; label: string }
type Choices = {
  label: string
  value: string
  options: Choice[]
  onChange: (value: string) => void
}
function Select({ label, value, options, onChange }: Choices): React.ReactElement {
  const id = React.useId()
  return h(
    'div',
    { className: 'sophon-select' },
    h('label', { htmlFor: id }, label),
    h(
      'select',
      {
        id,
        value,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)
      },
      options.map((option) => h('option', { key: option.value, value: option.value }, option.label))
    )
  )
}
function SegmentedControl({ label, value, options, onChange }: Choices): React.ReactElement {
  return h(
    'div',
    { className: 'sophon-segments', role: 'group', 'aria-label': label },
    options.map((option) =>
      h(
        'button',
        {
          key: option.value,
          type: 'button',
          'aria-pressed': option.value === value,
          onClick: () => onChange(option.value)
        },
        option.label
      )
    )
  )
}
function LineChart(options: ChartOptions): React.ReactElement {
  const element = React.useRef<HTMLDivElement>(null)
  const chart = React.useRef<Chart | null>(null)
  React.useEffect(
    () => () => {
      chart.current?.destroy()
      chart.current = null
    },
    []
  )
  React.useEffect(() => {
    if (chart.current) chart.current.update(options)
    else chart.current = host.sophon.lineChart(element.current!, options)
  }, [options])
  return React.createElement('div', { ref: element })
}
function Flow({ nodes }: { nodes: FlowNode[] }): React.ReactElement {
  const element = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const target = element.current!
    host.sophon.flow(target, nodes)
    return () => target.replaceChildren()
  }, [nodes])
  return React.createElement('div', { ref: element })
}
function Explorer(options: ExplorerOptions): React.ReactElement {
  const element = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const explorer = host.sophon.explorer(element.current!, options)
    return () => explorer.destroy()
  }, [options])
  return React.createElement('div', { ref: element })
}

const roots = new WeakMap<HTMLElement, Root>()
function mount(target: string | HTMLElement, node: React.ReactNode): { destroy: () => void } {
  const element = typeof target === 'string' ? document.querySelector(target) : target
  if (!(element instanceof HTMLElement))
    throw new Error('React visual target element was not found.')
  let root = roots.get(element)
  if (!root) {
    root = createRoot(element, {
      onUncaughtError(error) {
        // React catches render errors; forward them to the existing frame error bridge.
        window.dispatchEvent(
          new ErrorEvent('error', {
            message: error instanceof Error ? error.message : String(error)
          })
        )
      }
    })
    roots.set(element, root)
  }
  root.render(node)
  const mounted = root
  return {
    destroy() {
      if (roots.get(element) !== mounted) return
      mounted.unmount()
      roots.delete(element)
    }
  }
}

host.React = React
Object.assign(host.sophon, {
  h,
  mount,
  ui: Object.freeze({
    Stack,
    Grid,
    Card,
    Heading,
    Text,
    Metric,
    Button,
    Slider,
    Select,
    SegmentedControl,
    LineChart,
    Flow,
    Explorer
  })
})
