;(() => {
  let sequence = 0
  function explorer(container, options) {
    const host = typeof container === 'string' ? document.querySelector(container) : container
    if (!(host instanceof HTMLElement)) throw new Error('Explorer target element was not found.')
    if (
      !Array.isArray(options.controls) ||
      !options.controls.length ||
      typeof options.calculate !== 'function'
    )
      throw new Error('explorer needs controls and a calculate(values) function.')
    const create = (tag, className, text) => {
      const node = document.createElement(tag)
      node.className = className
      if (text != null) node.textContent = text
      return node
    }
    const root = create('div', 'sophon-stack sophon-explorer')
    const metrics = create('div', 'sophon-grid')
    const controls = create('div', 'sophon-stack sophon-controls')
    const chartHost = create('div', '')
    const inputs = new Map()
    const prefix = 'sophon-explorer-' + ++sequence + '-'
    let chart
    const number = (value, currency) =>
      new Intl.NumberFormat(
        'en-US',
        typeof currency === 'string' && /^[a-z]{3}$/i.test(currency)
          ? { style: 'currency', currency }
          : { maximumFractionDigits: 2 }
      ).format(value)
    for (const control of options.controls) {
      if (
        !control.id ||
        inputs.has(control.id) ||
        ![control.min, control.max, control.value].every(Number.isFinite) ||
        control.max <= control.min
      )
        throw new Error(
          'Each explorer control needs a unique id, finite min/max/value, and max greater than min.'
        )
      const group = create('div', 'sophon-control')
      const label = create('label', '', control.label || control.id)
      const output = create('output', '')
      const input = create('input', '')
      input.type = 'range'
      input.id = prefix + control.id
      input.min = control.min
      input.max = control.max
      input.step = control.step ?? 1
      input.value = control.value
      label.htmlFor = input.id
      output.htmlFor = input.id
      label.append(output)
      group.append(label, input)
      controls.append(group)
      inputs.set(control.id, { input, output, control })
      input.addEventListener('input', update)
    }
    root.append(metrics, controls, chartHost)
    host.replaceChildren(root)
    function update() {
      const values = Object.fromEntries(
        [...inputs].map(([id, { input, output, control }]) => {
          const value = Number(input.value)
          output.textContent = (control.prefix || '') + number(value) + (control.suffix || '')
          return [id, value]
        })
      )
      const result = options.calculate(values)
      if (!result || !Array.isArray(result.metrics))
        throw new Error(
          'calculate(values) must return {metrics:[{label,value}],chart:{labels,series}}. Chart is optional.'
        )
      metrics.replaceChildren(
        ...result.metrics.map((metric) => {
          if (typeof metric.value !== 'number' || !Number.isFinite(metric.value))
            throw new Error('Explorer metric values must be finite numbers.')
          const item = create('div', 'sophon-metric')
          const value = create('output', '', number(metric.value, metric.currency))
          item.append(create('span', '', metric.label), value)
          return item
        })
      )
      if (result.chart) {
        if (chart) chart.update(result.chart)
        else chart = window.sophon.lineChart(chartHost, result.chart)
      } else if (chart) {
        chart.destroy()
        chart = undefined
      }
    }
    update()
    return Object.freeze({
      destroy() {
        chart?.destroy()
        root.remove()
      }
    })
  }
  window.sophon.explorer = explorer
})()
