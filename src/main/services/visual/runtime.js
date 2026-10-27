;(() => {
  const colors = ['#7aacf5', '#e9af78', '#b39aeb', '#76c6ac', '#e891ac']
  const charts = new WeakMap()
  const element = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = text
    return node
  }
  const svgElement = (tag, attributes, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value))
    if (text != null) node.textContent = text
    return node
  }
  const target = (value) => {
    const node = typeof value === 'string' ? document.querySelector(value) : value
    if (!(node instanceof HTMLElement)) throw new Error('Visual target element was not found.')
    return node
  }
  const format = (value, options, compact = false) => {
    const currency =
      typeof options.currency === 'string' && /^[a-z]{3}$/i.test(options.currency)
        ? options.currency.toUpperCase()
        : undefined
    return new Intl.NumberFormat('en-US', {
      ...(currency ? { style: 'currency', currency } : {}),
      ...(compact
        ? { notation: 'compact', maximumFractionDigits: 1 }
        : { maximumFractionDigits: 2 })
    }).format(value)
  }
  const niceStep = (span) => {
    const base = 10 ** Math.floor(Math.log10(span / 4))
    return [1, 2, 2.5, 5, 10].find((step) => step * base >= span / 4) * base
  }
  function lineChart(container, initial) {
    const host = target(container)
    charts.get(host)?.destroy()
    let options = initial
    let geometry
    let selected = null
    const root = element('div', 'sophon-chart')
    const legend = element('div', 'sophon-legend')
    const svg = svgElement('svg', { tabindex: 0, role: 'img' })
    const detail = element('div', 'sophon-chart-detail')
    detail.setAttribute('role', 'status')
    const focus = svgElement('g', { 'pointer-events': 'none' })
    root.append(legend, svg, detail)
    host.replaceChildren(root)
    function inspect(index) {
      selected = index
      focus.replaceChildren()
      if (index == null || !geometry) {
        detail.textContent = 'Hover or use arrow keys to explore values'
        return
      }
      const { x, y, series, labels, top, bottom } = geometry
      focus.append(
        svgElement('line', {
          x1: x(index),
          x2: x(index),
          y1: top,
          y2: bottom,
          stroke: '#ffffff30',
          'stroke-dasharray': '3 4'
        })
      )
      const values = series.map((line) => {
        focus.append(
          svgElement('circle', {
            cx: x(index),
            cy: y(line.values[index]),
            r: 4,
            fill: line.color,
            stroke: '#151516',
            'stroke-width': 2
          })
        )
        return line.name + ': ' + format(line.values[index], options)
      })
      detail.textContent = labels[index] + ' · ' + values.join(' · ')
    }
    function draw() {
      const labels = options.labels
      const series = options.series?.map((line, index) => ({
        ...line,
        color: line.color || colors[index % colors.length]
      }))
      if (
        !Array.isArray(labels) ||
        !labels.length ||
        !series?.length ||
        series.some(
          (line) =>
            !Array.isArray(line.values) ||
            line.values.length !== labels.length ||
            line.values.some((value) => !Number.isFinite(value))
        )
      ) {
        throw new Error(
          'lineChart needs labels and series with one finite numeric value per label.'
        )
      }
      const values = series.flatMap((line) => line.values)
      const minimum = Math.min(0, ...values)
      const maximum = Math.max(0, ...values)
      const step = niceStep(maximum - minimum || 1)
      const low = Math.floor(minimum / step) * step
      const high = Math.ceil(maximum / step) * step || (low === 0 ? step : 0)
      const width = Math.max(260, Math.min(1400, host.clientWidth || 600))
      const height = 220
      const left = 62,
        right = width - 18,
        top = 26,
        bottom = height - 48
      const x = (index) =>
        labels.length === 1
          ? (left + right) / 2
          : left + (index / (labels.length - 1)) * (right - left)
      const y = (value) => bottom - ((value - low) / (high - low)) * (bottom - top)
      geometry = { x, y, series, labels, top, bottom, left, right }
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height)
      svg.setAttribute('aria-label', options.yLabel || 'Line chart')
      svg.replaceChildren()
      legend.replaceChildren()
      if (options.yLabel)
        svg.append(svgElement('text', { x: left, y: 11, 'font-size': 10 }, options.yLabel))
      for (let value = low; value <= high + step / 10; value += step) {
        svg.append(
          svgElement('line', {
            x1: left,
            x2: right,
            y1: y(value),
            y2: y(value),
            stroke: '#ffffff0d'
          })
        )
        svg.append(
          svgElement(
            'text',
            { x: left - 10, y: y(value) + 3, 'text-anchor': 'end', 'font-size': 10 },
            format(value, options, true)
          )
        )
      }
      const labelStep = Math.max(
        1,
        Math.ceil(labels.length / Math.max(2, Math.floor((right - left) / 65)))
      )
      labels.forEach((label, index) => {
        if (index % labelStep && index !== labels.length - 1) return
        if (index !== labels.length - 1 && labels.length - 1 - index < labelStep && index !== 0)
          return
        svg.append(
          svgElement(
            'text',
            {
              x: x(index),
              y: bottom + 22,
              'text-anchor': index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle',
              'font-size': 10
            },
            String(label)
          )
        )
      })
      if (options.xLabel)
        svg.append(
          svgElement(
            'text',
            { x: (left + right) / 2, y: height - 2, 'text-anchor': 'middle', 'font-size': 10 },
            options.xLabel
          )
        )
      for (const line of series) {
        const item = element('span')
        const swatch = element('i')
        swatch.style.background = line.color
        item.append(swatch, document.createTextNode(line.name))
        legend.append(item)
        svg.append(
          svgElement('polyline', {
            points: line.values.map((value, index) => x(index) + ',' + y(value)).join(' '),
            fill: 'none',
            stroke: line.color,
            'stroke-width': 2.25,
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
            'stroke-dasharray': line.dashed ? '6 5' : 'none',
            'data-series': line.name
          })
        )
        if (labels.length <= 12)
          line.values.forEach((value, index) =>
            svg.append(
              svgElement('circle', {
                cx: x(index),
                cy: y(value),
                r: 3,
                fill: line.color,
                stroke: '#151516',
                'stroke-width': 1.5
              })
            )
          )
      }
      svg.append(focus)
      inspect(selected == null ? null : Math.min(selected, labels.length - 1))
    }
    svg.addEventListener('pointermove', (event) => {
      const rect = svg.getBoundingClientRect()
      const position = ((event.clientX - rect.left) / rect.width) * svg.viewBox.baseVal.width
      const { left, right, labels } = geometry
      inspect(
        Math.max(
          0,
          Math.min(
            labels.length - 1,
            Math.round(((position - left) / (right - left)) * (labels.length - 1))
          )
        )
      )
    })
    svg.addEventListener('pointerleave', () => inspect(null))
    svg.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const last = geometry.labels.length - 1
      inspect(
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : Math.max(0, Math.min(last, (selected ?? 0) + (event.key === 'ArrowRight' ? 1 : -1)))
      )
    })
    draw()
    let lastWidth = host.clientWidth
    let pending = 0
    const observer = new ResizeObserver(() => {
      if (lastWidth !== host.clientWidth) {
        lastWidth = host.clientWidth
        if (!pending)
          pending = requestAnimationFrame(() => {
            pending = 0
            draw()
          })
      }
    })
    observer.observe(host)
    const api = Object.freeze({
      update(next) {
        options = { ...options, ...next }
        draw()
      },
      destroy() {
        observer.disconnect()
        cancelAnimationFrame(pending)
        root.remove()
        charts.delete(host)
      }
    })
    charts.set(host, api)
    return api
  }
  function flow(container, nodes) {
    const host = target(container)
    const root = element('div', 'sophon-flow')
    nodes.forEach((node, index) => {
      if (index) root.append(element('span', 'sophon-flow-arrow', '→'))
      const button = element('button')
      button.type = 'button'
      button.style.setProperty('--node-color', node.color || colors[index % colors.length])
      button.append(element('strong', '', node.label))
      if (node.description) button.append(element('small', '', node.description))
      button.addEventListener('click', () => {
        root
          .querySelectorAll('button')
          .forEach((item) => item.setAttribute('aria-pressed', String(item === button)))
        if (node.question) window.sophon.followUp(node.question)
      })
      root.append(button)
    })
    host.replaceChildren(root)
  }
  window.sophon = { lineChart, flow }
})()
