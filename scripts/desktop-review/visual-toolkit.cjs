const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function review({ evaluate, main, wait, profile }) {
  const source = `<!doctype html><html><head><title>Toolkit review</title></head><body>
<div id="flow"></div><div id="calculator"></div><div id="chart"></div><script>
sophon.flow('#flow',[{label:'Browser',question:'Explain the browser'},{label:'Database',question:'Explain the database'}]);
sophon.explorer('#calculator',{controls:[{id:'principal',label:'Starting amount',min:1000,max:20000,value:5000,step:100,prefix:'$'},{id:'rate',label:'Annual return',min:0,max:12,value:6,step:0.5,suffix:'%'},{id:'years',label:'Years',min:1,max:40,value:20}],calculate({principal,rate,years}){const labels=Array.from({length:years+1},(_,i)=>i);const values=labels.map(year=>principal*(1+rate/100)**year);return {metrics:[{label:'Final balance',value:values.at(-1),currency:'USD'},{label:'Interest earned',value:values.at(-1)-principal,currency:'USD'}],chart:{labels,series:[{name:'Balance',values}],currency:'USD',xLabel:'Year',yLabel:'Balance'}}}});
window.testChart=sophon.lineChart('#chart',{labels:['Jan','Feb','Mar'],series:[{name:'Web',values:[100,200,300]},{name:'Mobile',values:[50,150,250],dashed:true}],xLabel:'Month',yLabel:'Signups',currency:'K'});
</script></body></html>`
  const resource = await evaluate('window.api.visuals.create(' + JSON.stringify(source) + ')')
  await evaluate(
    `(()=>{const iframe=document.createElement('iframe');iframe.id='toolkit-review';iframe.sandbox='allow-scripts';iframe.style.cssText='position:fixed;left:0;top:0;width:620px;height:900px;border:0;z-index:999';iframe.src=${JSON.stringify(resource.url)};document.body.append(iframe)})()`
  )
  const frames = () => main.webContents.mainFrame.frames
  await wait(() => frames().some((frame) => frame.url === resource.url), 'toolkit frame')
  const frame = frames().find((frame) => frame.url === resource.url)
  const inspect = (code) => frame.executeJavaScript(code, true)
  try {
    await wait(() => inspect('!!window.testChart'), 'toolkit initialized')
    assert.match(await inspect('document.querySelector("#calculator").innerText'), /16,035\.68/)
    assert.equal(await inspect('document.querySelectorAll("input[type=range]").length'), 3)
    for (const [id, value] of [
      ['principal', 7000],
      ['rate', 10],
      ['years', 30]
    ]) {
      const result = await inspect(
        `(()=>{const input=document.querySelector('input[id$="-${id}"]');input.value=${value};input.dispatchEvent(new Event('input'));const inputs=Array.from(document.querySelectorAll('input'));return {values:inputs.map(i=>Number(i.value)),result:document.querySelector('.sophon-metric output').textContent,points:document.querySelector('#calculator polyline').getAttribute('points')}})()`
      )
      const [principal, rate, years] = result.values
      assert(
        Math.abs(
          Number(result.result.replace(/[^0-9.]/g, '')) - principal * (1 + rate / 100) ** years
        ) < 0.01
      )
      assert(!/NaN|Infinity/.test(result.points))
    }
    await inspect(
      'document.querySelector("#chart svg").dispatchEvent(new KeyboardEvent("keydown",{key:"End"}))'
    )
    await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    await wait(
      () => inspect('document.querySelector("#chart svg").getBoundingClientRect().width > 0'),
      'chart pointer geometry'
    )
    assert.match(
      await inspect('document.querySelector("#chart .sophon-chart-detail").textContent'),
      /Mar.*Web: 300.*Mobile: 250/
    )
    await inspect(
      '(()=>{const svg=document.querySelector("#chart svg");const r=svg.getBoundingClientRect();const x=Number(svg.querySelector("polyline").getAttribute("points").split(",")[0]);svg.dispatchEvent(new PointerEvent("pointermove",{clientX:r.left+x*r.width/svg.viewBox.baseVal.width,clientY:r.top+80}))})()'
    )
    assert.match(
      await inspect('document.querySelector("#chart .sophon-chart-detail").textContent'),
      /Jan.*Web: 100.*Mobile: 50/
    )
    for (const values of [[0, 0, 0], [-30, -10, -20], [-10, 0, 20], [42]]) {
      const result = await inspect(
        `(()=>{testChart.update({labels:${JSON.stringify(values.map((_, index) => index))},series:[{name:'<img src=x onerror=alert(1)>',values:${JSON.stringify(values)}}]});const svg=document.querySelector('#chart svg');return {width:svg.viewBox.baseVal.width,height:svg.viewBox.baseVal.height,points:svg.querySelector('polyline').getAttribute('points'),images:document.querySelectorAll('#chart img').length}})()`
      )
      assert.equal(result.images, 0)
      for (const point of result.points.split(' ')) {
        const [x, y] = point.split(',').map(Number)
        assert(Number.isFinite(x) && x >= 0 && x <= result.width)
        assert(Number.isFinite(y) && y >= 0 && y <= result.height)
      }
    }
    await evaluate('document.querySelector("#toolkit-review").style.width="300px"')
    await wait(
      () => inspect('document.querySelector("#chart svg").viewBox.baseVal.width < 300'),
      'responsive chart sizing'
    )
    assert(await inspect('document.documentElement.scrollWidth <= innerWidth'))
    await inspect(
      '(()=>{const svg=document.querySelector("#calculator svg");svg.dispatchEvent(new KeyboardEvent("keydown",{key:"End"}))})()'
    )
    assert.match(
      await inspect('document.querySelector("#calculator .sophon-chart-detail").textContent'),
      /122,145\.82/
    )
    await evaluate(
      `window.toolkitMessages=[];window.toolkitReceive=e=>{if(e.source===document.querySelector('#toolkit-review')?.contentWindow)window.toolkitMessages.push(e.data)};addEventListener('message',window.toolkitReceive)`
    )
    await inspect('document.querySelectorAll("#flow button")[1].click()')
    await wait(
      () =>
        evaluate(
          'window.toolkitMessages.some(m=>m.type==="follow-up"&&m.value==="Explain the database")'
        ),
      'toolkit follow-up bridge'
    )
    await evaluate('window.api.visuals.save(' + JSON.stringify(resource.id) + ')')
    const saved = fs.readFileSync(path.join(profile, 'saved.png'), 'utf8')
    assert(saved.includes('function explorer(') && saved.includes('function lineChart('))
    assert(saved.includes('Content-Security-Policy'))
    console.log(
      'PASS themed toolkit: independent slider calculations, chart scaling for zero/negative/single-point data, hover/keyboard values, 300px layout, safe labels, follow-up, embedded export'
    )
  } finally {
    await evaluate(
      'document.querySelector("#toolkit-review")?.remove();if(window.toolkitReceive)removeEventListener("message",window.toolkitReceive)'
    )
    await evaluate('window.api.visuals.release(' + JSON.stringify(resource.id) + ')')
  }
}
