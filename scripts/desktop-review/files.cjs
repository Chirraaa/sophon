const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

module.exports = async function review({ evaluate, workspace, profile, wait }) {
  const tool = (name, args) => 'tool:' + name + '|' + JSON.stringify(args)
  await evaluate('window.api.chats.create()')
  const local = await evaluate('window.api.getSession()')
  const approvedRead = async (name, args) => {
    await evaluate(`void window.api.send(${JSON.stringify(tool(name, args))})`)
    await wait(
      () =>
        evaluate(
          'window.api.getSession().then(s => !s.busy || s.items.at(-1).actions.some(a=>a.status==="waiting"))'
        ),
      'read approval or policy denial'
    )
    const state = await evaluate('window.api.getSession()')
    const action = state.items.at(-1).actions.find((a) => a.status === 'waiting')
    if (action) await evaluate(`window.api.approve(${JSON.stringify(action.id)}, 'once')`)
    await wait(() => evaluate('window.api.getSession().then(s => !s.busy)'), 'read completed')
  }
  await approvedRead('read_file', { path: 'notes.txt' })
  let last = await evaluate('window.api.getSession().then(s => s.items.at(-1))')
  assert.match(last.actions[0].detail, /silver/)
  await approvedRead('read_file', { path: '../outside.txt' })
  last = await evaluate('window.api.getSession().then(s => s.items.at(-1))')
  assert.match(last.actions[0].detail, /outside your working folder|unsafe or sensitive/)
  await approvedRead('read_file', { path: 'sample.png' })
  last = await evaluate('window.api.getSession().then(s => s.items.at(-1))')
  assert.equal(last.attachments.length, 1)
  await evaluate(
    `void window.api.send(${JSON.stringify(tool('write_file', { path: 'result.txt', content: 'Reviewed locally.' }))})`
  )
  await wait(
    () =>
      evaluate(
        'window.api.getSession().then(s => s.items.at(-1).actions.some(a => a.status === "waiting"))'
      ),
    'write permission'
  )
  assert.equal(fs.existsSync(path.join(workspace, 'result.txt')), false)
  await evaluate(
    'window.api.getSession().then(s => window.api.approve(s.items.at(-1).actions[0].id, "once"))'
  )
  await wait(() => evaluate('window.api.getSession().then(s => !s.busy)'), 'write completes')
  assert.equal(fs.readFileSync(path.join(workspace, 'result.txt'), 'utf8'), 'Reviewed locally.')
  const ciphertext = fs.readFileSync(path.join(profile, 'conversations/index.json'))
  assert(ciphertext.subarray(0, 8).equals(Buffer.from('SOPHON2\0')))
  assert(!ciphertext.includes(Buffer.from('Reviewed locally.')))
  assert.equal((await evaluate('window.api.getSession()')).chats.length, 3)
  await evaluate(`window.api.chats.delete(${JSON.stringify(local.chatId)})`)
  console.log(
    'PASS file read/write, write approval, path traversal blocked, tool image shown, chat persistence'
  )
}
