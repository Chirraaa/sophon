const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

module.exports = async function review({ evaluate, main, output, wait, delay }) {
  const capture = await evaluate('window.api.attachments.pick().then(a => a[0])')
  assert.match(capture.mimeType, /^image\//)
  assert(capture.size > 0)
  const hardware = await evaluate('window.api.hardware()')
  assert(hardware.memoryTotal > 0 && hardware.logicalCores > 0 && hardware.displays.length > 0)
  await evaluate(
    'Array.from(document.querySelectorAll("nav button")).find(b => b.textContent === "Settings").click()'
  )
  for (const name of [
    'General',
    'Model',
    'Behavior',
    'Memory',
    'Permissions',
    'Voice',
    'Files',
    'Hardware'
  ]) {
    await evaluate(
      `Array.from(document.querySelectorAll('[role="tab"]')).find(b => b.textContent === ${JSON.stringify(name)}).click()`
    )
    await wait(
      () =>
        evaluate(
          `Array.from(document.querySelectorAll('[role="tab"]')).some(b => b.textContent === ${JSON.stringify(name)} && b.getAttribute('aria-selected') === 'true')`
        ),
      name + ' tab'
    )
    await delay(150)
    assert(await evaluate('document.querySelector("[role=tabpanel]").innerText.length > 0'))
  }
  fs.writeFileSync(
    path.join(output, 'features-hardware.png'),
    (await main.webContents.capturePage()).toPNG()
  )
  const devices = await evaluate(
    `(async () => {
      await window.api.voice.beginDeviceDetection()
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').map(d => d.toJSON())
      } finally {
        stream?.getTracks().forEach(track => track.stop())
        await window.api.voice.endDeviceDetection()
      }
    })()`
  )
  assert(devices.length > 0)
  const chosen = devices.find(
    (device) => device.deviceId && !['default', 'communications'].includes(device.deviceId)
  )
  assert(chosen)
  const update = await evaluate(
    `window.api.updateSettings({voice:{deviceId:${JSON.stringify(chosen.deviceId)}}})`
  )
  assert.notEqual(update?.ok, false)
  assert.equal((await evaluate('window.api.getSettings()')).voice.deviceId, chosen.deviceId)
  await evaluate('window.api.updateSettings({motion:"reduced"})')
  await wait(
    () => evaluate('document.documentElement.dataset.reducedMotion === "true"'),
    'reduced motion preference'
  )
  await evaluate('window.api.updateSettings({motion:"full"})')
  await wait(
    () => evaluate('document.documentElement.dataset.reducedMotion === "false"'),
    'smooth motion preference'
  )
  console.log(
    'PASS synthetic image import, all eight settings tabs, hardware data and selected microphone setting'
  )
}
