const { app, BrowserWindow, globalShortcut, ipcMain, dialog } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/visual-ui')
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(output, 'profile-'))
app.setPath('userData', profile)
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
dialog.showMessageBox = async () => ({ response: 1 })
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(profile, 'saved.png') })
let state = {
  chatId: 'visual-fixture',
  mode: 'assistant',
  busy: false,
  chats: [{ id: 'visual-fixture', title: 'Visuals', updatedAt: Date.now() }],
  items: []
}
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, (...args) => (channel === 'session:get' ? state : listener(...args)))
app.on('web-contents-created', (_, contents) => {
  contents.on('console-message', (details) => {
    if (
      details.level === 'error' &&
      !/Content Security Policy|Loading the font|react-fixture-error/.test(details.message)
    )
      console.error('Renderer:', details.message.slice(0, 1000))
  })
})
app.on('window-all-closed', () => app.quit())
require(path.join(root, 'out/main/index.js'))

const source = `<!doctype html><html><head><title>React scenario explorer</title></head><body><div id="app"></div><script>
const {h,ui}=sophon;
function App(){
 const [amount,setAmount]=React.useState(40);
 const [variant,setVariant]=React.useState('calm');
 const [unit,setUnit]=React.useState('items');
 return h(ui.Stack,null,
  h(ui.Heading,{title:'Make it yours',subtitle:'Same content. A different point of view.'}),
  h(ui.SegmentedControl,{label:'Style',value:variant,onChange:setVariant,options:[{value:'calm',label:'Calm'},{value:'bold',label:'Bold'}]}),
  h(ui.Select,{label:'Unit',value:unit,onChange:setUnit,options:[{value:'items',label:'Items'},{value:'points',label:'Points'}]}),
  h(ui.Slider,{label:'Amount',min:0,max:100,value:amount,onChange:setAmount}),
  h(ui.Card,null,h(ui.Stack,null,
   h(ui.Heading,{title:variant==='calm'?'A little clarity':'A bold direction',subtitle:'An interactive React preview.'}),
   h(ui.Grid,null,h(ui.Metric,{label:unit,value:amount}),h(ui.Metric,{label:'Double',value:amount*2})),
   h(ui.LineChart,{labels:[0,1,2],series:[{name:'Amount',values:[0,amount,amount*2]}],xLabel:'Step',yLabel:unit}))),
  h(ui.Flow,{nodes:[{label:'Explore',question:'Explain this scenario'},{label:'Compare'}]}));
}
window.mounted=sophon.mount('#app',h(App));
</script></body></html>`
async function wait(check, label) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(50)
  }
  throw new Error('Timed out: ' + label)
}
async function review() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'windows')
  const main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  const compact = BrowserWindow.getAllWindows().find((win) => !win.isResizable())
  const evaluate = (code) => main.webContents.executeJavaScript(code, true)
  for (const win of [main, compact]) win.webContents.setBackgroundThrottling(false)
  await wait(() => !main.webContents.isLoading() && !compact.webContents.isLoading(), 'renderers')
  const publish = (text, pending = false, mode = 'assistant') => {
    state = {
      ...state,
      mode,
      busy: pending,
      items: [{ id: 'reply', from: 'agent', text, pending, actions: [] }]
    }
    for (const win of [main, compact]) win.webContents.send('session:update', state)
  }
  const capture = async (name, win = main) => {
    const captureFrame = async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await win.webContents.capturePage(undefined, {
            stayHidden: true,
            stayAwake: true
          })
        } catch (error) {
          if (attempt >= 3 || !String(error).includes('UnknownVizError')) throw error
          await delay(300)
        }
      }
    }
    await captureFrame()
    await delay(150)
    fs.writeFileSync(path.join(output, name + '.png'), (await captureFrame()).toPNG())
  }
  for (const [language, code] of [
    ['html', source.slice(0, 700)],
    ['svg', '<svg viewBox="0 0 10 10">'],
    ['mermaid', 'graph LR\nA-->B'],
    ['xml', '<svg viewBox="0 0 10 10">'],
    ['visualization', '<div>Preview</div>']
  ]) {
    publish('Here is your preview.\n\n```' + language + '\n' + code, true)
    for (const win of [main, compact]) {
      await wait(
        () =>
          win.webContents.executeJavaScript('!!document.querySelector("[data-visual-loading]")'),
        language + ' loading'
      )
      assert.equal(
        await win.webContents.executeJavaScript(
          'document.querySelectorAll("[data-code-block],iframe").length'
        ),
        0
      )
    }
  }
  await capture('building-visual')
  publish('```javascript\nconst answer = 42', true)
  await wait(
    () => evaluate('!!document.querySelector("[data-code-block]")'),
    'ordinary code remains visible'
  )
  publish('```html\n<h1>Research code</h1>\n```', false, 'research')
  await wait(
    () =>
      evaluate(
        'document.querySelector("[data-code-block]")?.textContent.includes("Research code")'
      ),
    'research source view'
  )
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0)
  publish('```html\n<html><body>Interrupted')
  await wait(
    () => evaluate('document.body.innerText.includes("stopped before finishing")'),
    'interrupted visual recovery'
  )
  publish('Try changing the options below.\n\n```html\n' + source + '\n```')
  const frame = () =>
    main.webContents.mainFrame.frames.find((frame) => frame.url.startsWith('sophon-visual:'))
  await wait(() => !!frame(), 'React iframe')
  const inspect = (code) => frame().executeJavaScript(code, true)
  await wait(
    () => inspect('document.querySelector(".sophon-metric output")?.textContent === "40"'),
    'React mounted'
  )
  await wait(() => inspect('!!document.querySelector("polyline")'), 'chart mounted')
  main.webContents.debugger.attach('1.3')
  await main.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true
  })
  await evaluate(
    `{ const trigger = document.querySelector('[aria-label="Expand visual"]'); trigger.focus(); trigger.click() }`
  )
  await wait(
    () => evaluate('!!document.querySelector("[data-slot=dialog-content] iframe")'),
    'shared expanded visual dialog'
  )
  await wait(
    () => evaluate('document.querySelector("[role=dialog]").contains(document.activeElement)'),
    'expanded visual owns focus'
  )
  main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await wait(
    () =>
      evaluate(
        '!document.querySelector("[role=dialog]") && !!document.querySelector("[data-visual-panel] iframe")'
      ),
    'Escape restores inline visual'
  )
  await wait(() => !!frame(), 'restored visual iframe')
  await wait(
    () => inspect('document.querySelector(".sophon-metric output")?.textContent === "40"'),
    'restored visual renders'
  )
  assert.equal(await inspect('typeof window.api + ":" + typeof require'), 'undefined:undefined')
  assert.equal(
    await inspect('(()=>{try{return parent.document.title}catch{return "blocked"}})()'),
    'blocked'
  )
  assert.equal(
    await inspect('fetch("https://example.com").then(()=>"allowed",()=>"blocked")'),
    'blocked'
  )
  await inspect(
    `(()=>{const input=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'75');input.dispatchEvent(new Event('input',{bubbles:true}))})()`
  )
  await wait(
    () => inspect('document.querySelectorAll(".sophon-metric output")[1].textContent === "150"'),
    'React state updates metrics'
  )
  await inspect(
    'document.querySelector(".sophon-chart svg").dispatchEvent(new KeyboardEvent("keydown",{key:"End"}))'
  )
  await wait(
    () => inspect('document.querySelector(".sophon-chart-detail").textContent.includes("150")'),
    'React state updates chart data'
  )
  await inspect('document.querySelectorAll(".sophon-segments button")[1].click()')
  await wait(
    () => inspect('document.querySelector(".sophon-card h2").textContent === "A bold direction"'),
    'segmented control'
  )
  await inspect(
    'document.querySelector("select").value="points";document.querySelector("select").dispatchEvent(new Event("change",{bubbles:true}))'
  )
  await wait(
    () => inspect('document.querySelector(".sophon-metric span").textContent === "points"'),
    'select'
  )
  await capture('react-visual')
  await evaluate('document.querySelector("iframe").style.width="300px"')
  await delay(100)
  assert(await inspect('document.documentElement.scrollWidth <= innerWidth'))
  await inspect('document.querySelector(".sophon-flow button").click()')
  await wait(
    () => evaluate('document.body.innerText.includes("Explain this scenario")'),
    'React follow-up bridge'
  )
  assert.equal(state.items.length, 1)
  await evaluate(`document.querySelector('[aria-label="Save visual"]').click()`)
  await wait(
    () =>
      fs.existsSync(path.join(profile, 'saved.png')) &&
      fs.readFileSync(path.join(profile, 'saved.png'), 'utf8').includes('</html>'),
    'export'
  )
  const saved = fs.readFileSync(path.join(profile, 'saved.png'), 'utf8')
  assert(saved.includes('Content-Security-Policy') && saved.includes('sophon.mount'))
  const exported = new BrowserWindow({
    show: false,
    width: 680,
    height: 900,
    webPreferences: {
      partition: 'visual-export-fixture-' + Date.now(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const externalRequests = []
  exported.webContents.session.webRequest.onBeforeRequest((request, done) => {
    const external = !/^(file|data):/.test(request.url)
    if (external) externalRequests.push(request.url)
    done({ cancel: external })
  })
  const savedHtml = path.join(profile, 'export.html')
  fs.writeFileSync(savedHtml, saved)
  await exported.loadFile(savedHtml)
  await wait(
    () =>
      exported.webContents.executeJavaScript(
        'document.querySelector(".sophon-metric output")?.textContent === "40"'
      ),
    'offline export mounts React'
  )
  assert.deepEqual(externalRequests, [])
  await capture('react-export', exported)
  exported.destroy()
  await evaluate(`document.querySelector('[aria-label="Reset visual"]').click()`)
  await wait(() => !!frame(), 'reset frame')
  await wait(
    () => inspect('document.querySelector(".sophon-metric output")?.textContent === "40"'),
    'reset React state'
  )
  await inspect(
    `sophon.mount('#app',sophon.h(sophon.ui.Explorer,{controls:[{id:'amount',label:'Amount',min:0,max:100,value:20}],calculate({amount}){return {metrics:[{label:'Double',value:amount*2}]}}}))`
  )
  await wait(() => inspect('!!document.querySelector(".sophon-explorer")'), 'React explorer')
  await inspect(
    `document.querySelector('input').value=30;document.querySelector('input').dispatchEvent(new Event('input'))`
  )
  assert.equal(await inspect('document.querySelector(".sophon-metric output").textContent'), '60')
  await inspect('mounted.destroy()')
  assert.equal(await inspect('document.querySelector("#app").childElementCount'), 0)
  publish(
    '```html\n<!doctype html><html><head><title>React failure</title></head><body><div id="app"></div><script>function Broken(){throw new Error("react-fixture-error")}sophon.mount("#app",sophon.h(Broken))</script></body></html>\n```'
  )
  await wait(
    () => evaluate('document.body.innerText.includes("react-fixture-error")'),
    'React render error recovery'
  )
  await require('./desktop-review/visual-toolkit.cjs')({ evaluate, main, wait, profile })
  console.log(
    'PASS visual streaming in full/compact chat, normal code, research, interruption, React state/controls/charts, 300px layout, isolation, follow-up, offline export, reset, cleanup, render errors, legacy toolkit'
  )
}
review()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
