const assert = require('node:assert/strict')

module.exports = async function review({ main, evaluate, wait, delay, runVisuals }) {
  const frame = main.webContents.mainFrame.frames.find((value) =>
    value.url.startsWith('sophon-visual:')
  )
  assert(frame)
  assert.equal(
    await frame.executeJavaScript(
      'fetch("https://visual-test.invalid/leak").then(()=>"allowed",()=>"blocked")'
    ),
    'blocked'
  )
  const count = await evaluate('window.api.getSession().then(s=>s.items.length)')
  await frame.executeJavaScript(
    'parent.postMessage({channel:"sophon-visual",id:location.pathname.slice(1),type:"follow-up",value:"Unsolicited request"},"*")'
  )
  await delay(100)
  assert.equal(await evaluate('window.api.getSession().then(s=>s.items.length)'), count)
  const original = frame.url
  const failed = []
  const onFailed = (_event, _code, description, url) => failed.push({ description, url })
  main.webContents.on('did-fail-load', onFailed)
  await frame.executeJavaScript('location.href="https://visual-test.invalid/navigation";undefined')
  await delay(100)
  main.webContents.removeListener('did-fail-load', onFailed)
  assert(
    frame.url === original ||
      failed.some(
        (event) =>
          event.url === 'https://visual-test.invalid/navigation' &&
          /ERR_BLOCKED_BY_(CSP|CLIENT)/.test(event.description)
      )
  )
  await evaluate('window.api.send("Show a broken visual example")')
  await runVisuals()
  await wait(
    () => evaluate('document.body.innerText.includes("intentional-visual-test")'),
    'runtime error displayed'
  )
  assert(
    await evaluate(
      'Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Ask Sophon to fix it")'
    )
  )
  await evaluate('window.api.send("Show a truncated visual example")')
  await wait(
    () =>
      evaluate(
        'document.body.innerText.includes("The model stopped before finishing this visual")'
      ),
    'truncated document explained'
  )
  assert(
    !(await evaluate('document.body.innerText.includes("The model reached its output limit")'))
  )
  console.log(
    'PASS visual network/navigation isolation, no automatic follow-up send, runtime error feedback and truncated response recovery'
  )
}
