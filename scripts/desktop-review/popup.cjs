const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

module.exports = async function review({
  compactEval,
  main,
  compact,
  screen,
  shortcuts,
  output,
  wait,
  delay
}) {
  main.hide()
  compact.hide()
  shortcuts.get('Control+Alt+V')()
  await wait(
    () => compactEval('window.api.voice.getState().then(s => s.phase === "listening")'),
    'hidden voice listening'
  )
  assert.equal((await compactEval('window.api.compact.presentation()')).mode, 'voice')
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  assert.equal(compact.getBounds().y, area.y)
  assert(
    Math.abs(compact.getBounds().x + compact.getBounds().width / 2 - (area.x + area.width / 2)) < 2
  )
  assert.equal(compact.isMovable(), true)
  assert.equal(
    await compactEval(
      'getComputedStyle(document.querySelector(".compact-arrive")).animationDuration'
    ),
    '0.42s'
  )
  assert.equal(
    await compactEval('getComputedStyle(document.querySelector("header")).webkitAppRegion'),
    'drag'
  )
  await delay(400)
  assert(await compactEval('document.body.innerText.includes("Listening")'))
  const collapsedWidth = await compactEval(
    'document.querySelector(".compact-arrive").getBoundingClientRect().width'
  )
  assert(collapsedWidth < 350)
  fs.writeFileSync(
    path.join(output, 'features-voice.png'),
    (await compact.webContents.capturePage()).toPNG()
  )
  await compactEval('window.api.voice.cancel()')
  await delay(500)
  assert(
    await compactEval(
      'document.querySelector(".compact-arrive").getBoundingClientRect().width > 500'
    )
  )
  const moved = { ...compact.getBounds(), x: area.x + 50, y: area.y + 120 }
  compact.setBounds(moved)
  compact.emit('will-move', {}, moved)
  compact.hide()
  shortcuts.get('Control+Alt+Space')()
  await wait(
    () => compactEval('document.activeElement?.tagName === "TEXTAREA"'),
    'quick command autofocus'
  )
  assert.equal(compact.getBounds().x, moved.x)
  assert.equal(compact.getBounds().y, moved.y)
  console.log(
    'PASS hidden voice entry, fake selected mic capture, collapsed panel, expansion, drag region and remembered position'
  )
}
