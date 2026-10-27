const assert = require('node:assert/strict')
const path = require('node:path')
module.exports = async ({ load }) => {
  let bytes = Buffer.alloc(0)
  let readback = 'match'
  const files = load('src/main/tools/files.ts', {
    'fs/promises': {
      realpath: async (p) => p,
      lstat: async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
      stat: async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }
    },
    path,
    '../settings': { getSettings: () => ({ files: { workspace: 'M:\\fixture' } }) },
    '../security/workspace-handles': {
      writeLockedDocument: (_root, _file, content) => {
        bytes = content
      },
      readLockedDocument: () => {
        if (readback === 'error') throw new Error('read failure')
        return readback === 'match' ? bytes : Buffer.from('different')
      }
    },
    '../security/run-manager': { currentRun: () => undefined },
    '../security/workspace-policy': {
      validateWorkspaceRoot: async (p) => p,
      SENSITIVE_PART: /secret/,
      READ_EXTENSIONS: new Set(['.txt']),
      WRITE_EXTENSIONS: new Set(['.txt'])
    },
    '../llm/untrusted-data': {},
    '../services/isolated-parser': {}
  })
  assert.match(
    await files.writeWorkspaceFile({ path: 'test.txt', content: 'Verified bytes' }),
    /Verified by reading back/
  )
  readback = 'mismatch'
  assert.match(
    await files.writeWorkspaceFile({ path: 'test.txt', content: 'Verified bytes' }),
    /^Unverified/
  )
  readback = 'error'
  assert.match(
    await files.writeWorkspaceFile({ path: 'test.txt', content: 'Verified bytes' }),
    /^Unverified/
  )

  let rect = { left: 0, top: 0, right: 100, bottom: 100 }
  let accepted = true
  let apply = true
  let minimized = false
  let maximized = false
  const mon = { index: 1, work: { x: 0, y: 0, width: 1000, height: 800 } }
  const win = {
    hwnd: 1,
    title: 'Fixture',
    exe: 'fixture.exe',
    state: 'normal',
    x: 0,
    y: 0,
    width: 100,
    height: 100
  }
  const move = load('src/main/tools/window-move.ts', {
    '../permissions': { protectedWindowRule: () => undefined },
    '../security/run-manager': { currentRun: () => undefined },
    './windows': { findWindow: () => win, listWindowsText: () => '' },
    './monitors': { monitorOf: () => mon, resolveMonitor: () => mon, monitorsText: () => '' },
    './win32': {
      SW_MINIMIZE: 1,
      SW_MAXIMIZE: 2,
      SW_RESTORE: 3,
      bringToFront: () => {},
      getVisibleRect: () => rect,
      isMinimized: () => minimized,
      isMaximized: () => maximized,
      showWindow: (_h, state) => {
        if (apply) {
          minimized = state === 1
          maximized = state === 2
        }
      },
      placeWindow: (_h, x, y, width, height) => {
        if (apply) rect = { left: x, top: y, right: x + width, bottom: y + height }
        return accepted
      }
    }
  }).moveWindow
  assert.match(await move({ title: 'Fixture', position: 'left_half' }), /Verified window state/)
  assert.match(await move({ title: 'Fixture', position: 'right_third' }), /Verified window state/)
  assert.deepEqual(rect, { left: 666, top: 0, right: 1000, bottom: 800 })
  assert.match(await move({ title: 'Fixture', width: -1 }), /^Invalid/)
  apply = false
  assert.match(await move({ title: 'Fixture', position: 'right_half' }), /^Unverified/)
  accepted = false
  assert.match(await move({ title: 'Fixture', position: 'right_half' }), /^Windows refused/)
  accepted = true
  apply = true
  assert.match(await move({ title: 'Fixture', position: 'minimize' }), /Verified window state/)
  assert.match(await move({ title: 'Fixture', position: 'restore' }), /Verified window state/)
  assert.match(await move({ title: 'Fixture', position: 'maximize' }), /Verified window state/)
  console.log(
    'PASS actual file/window tool code: byte readback match/mismatch/error, accepted-but-unapplied move, OS refusal and window-state verification; native boundaries stubbed'
  )
}
