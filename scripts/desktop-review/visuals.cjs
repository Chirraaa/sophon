const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function reviewVisuals({
  evaluate,
  main,
  wait,
  delay,
  getRequest,
  output,
  profile,
  runVisuals
}) {
  await evaluate(
    'window.api.send("Show an interactive visual showcase with a flowchart, chart and growth widget")'
  )
  assert.equal(getRequest().max_tokens, 8192)
  assert.match(getRequest().messages[0].content, /window.sophon.followUp/)
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Run visual')`
    ),
    false
  )
  await runVisuals()
  await wait(
    () =>
      evaluate(
        `Array.from(document.querySelectorAll('iframe')).filter(f=>f.src.startsWith('sophon-visual:')).length === 3`
      ),
    'three inline visuals'
  )
  const frames = () =>
    main.webContents.mainFrame.frames.filter((frame) => frame.url.startsWith('sophon-visual:'))
  await wait(() => frames().length === 3, 'sandboxed frames')
  await wait(
    async () =>
      (
        await Promise.all(frames().map((frame) => frame.executeJavaScript('!!document.title')))
      ).every(Boolean),
    'visual documents loaded'
  )
  const find = async (title) => {
    for (const frame of frames())
      if ((await frame.executeJavaScript('document.title')) === title) return frame
    throw new Error('Missing ' + title)
  }
  const widget = await find('Explore compound growth')
  await wait(
    () => widget.executeJavaScript('document.querySelector("#balance").textContent === "$16,036"'),
    'initial calculator values'
  )
  const before = await widget.executeJavaScript(
    'document.querySelector("#curve").getAttribute("points")'
  )
  await widget.executeJavaScript(
    'document.querySelector("#rate").value=10;document.querySelector("#rate").dispatchEvent(new Event("input",{bubbles:true}))',
    true
  )
  assert.equal(
    await widget.executeJavaScript('document.querySelector("#balance").textContent'),
    '$33,637'
  )
  assert.notEqual(
    await widget.executeJavaScript('document.querySelector("#curve").getAttribute("points")'),
    before
  )
  assert.equal(
    await widget.executeJavaScript('typeof window.api + ":" + typeof require'),
    'undefined:undefined'
  )
  assert.equal(
    await widget.executeJavaScript(
      '(()=>{try{return parent.document.title}catch{return "blocked"}})()'
    ),
    'blocked'
  )
  const chart = await find('Web and mobile signups')
  assert.equal(await chart.executeJavaScript('document.querySelectorAll("circle").length'), 12)
  await chart.executeJavaScript(
    'document.querySelector("circle").dispatchEvent(new PointerEvent("pointerenter"))'
  )
  assert.match(
    await chart.executeJavaScript('document.querySelector("#hover").textContent'),
    /Jan: 120/
  )
  const flow = await find('How a web request travels')
  await flow.executeJavaScript('document.querySelectorAll("button")[1].click()', true)
  await wait(
    () => evaluate('document.body.innerText.includes("Explain the load balancer")'),
    'node follow-up question'
  )
  const initialItems = await evaluate('window.api.getSession().then(s=>s.items.length)')
  assert.equal(initialItems, (await evaluate('window.api.getSession()')).items.length)
  await evaluate(
    'Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Ask Sophon").click()'
  )
  await wait(
    () =>
      evaluate(
        'window.api.getSession().then(s=>!s.busy&&s.items.at(-2).text==="Explain the load balancer")'
      ),
    'explicit follow-up send'
  )
  assert.equal(getRequest().max_tokens, 8192)
  await evaluate(
    `Array.from(document.querySelectorAll('[aria-label="Expand visual"]')).at(-1).click()`
  )
  await wait(() => evaluate('!!document.querySelector("dialog:modal iframe")'), 'expanded visual')
  assert.equal(
    await widget.executeJavaScript('document.querySelector("#balance").textContent'),
    '$33,637'
  )
  await delay(300)
  fs.writeFileSync(
    path.join(output, 'interactive-widget.png'),
    (await main.webContents.capturePage()).toPNG()
  )
  await evaluate(`document.querySelector('[aria-label="Close expanded visual"]').click()`)
  await wait(() => evaluate('!document.querySelector("dialog:modal")'), 'close expanded visual')
  await evaluate(
    `Array.from(document.querySelectorAll('[aria-label="View source"]')).at(-1).click()`
  )
  assert(
    await evaluate(
      'Array.from(document.querySelectorAll("pre")).some(p=>p.textContent.includes("function draw()"))'
    )
  )
  await evaluate(`document.querySelector('[aria-label="Preview visual"]').click()`)
  await evaluate(
    `Array.from(document.querySelectorAll('[aria-label="Save visual"]')).at(-1).click()`
  )
  await wait(
    () =>
      fs.readFileSync(path.join(profile, 'saved.png'), 'utf8').includes('Content-Security-Policy'),
    'self-contained HTML saved'
  )
  assert(fs.readFileSync(path.join(profile, 'saved.png'), 'utf8').includes('function draw()'))
  console.log(
    'PASS interactive diagrams, two-series chart, live calculator numbers and curve, follow-up, expand/source/save, visual token budget, frame isolation'
  )
}
