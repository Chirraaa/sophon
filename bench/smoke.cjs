const assert = require('node:assert/strict')
const { createHarness } = require('./harness.cjs')
const { tasks } = require('./tasks.cjs')
const { score, visualCheck } = require('./score.cjs')
const response = (content, tool_calls) => ({
  choices: [
    {
      message: { role: 'assistant', content, ...(tool_calls ? { tool_calls } : {}) },
      finish_reason: 'stop'
    }
  ],
  usage: { prompt_tokens: 100, completion_tokens: 10 }
})
const call = (name, args = {}, id = 'call-1') => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) }
})
async function main() {
  assert.equal(tasks.length, 110)
  for (const category of new Set(tasks.map((t) => t.category))) {
    assert.equal(tasks.filter((t) => t.category === category && t.split === 'heldout').length, 3)
  }
  assert.equal(new Set(tasks.map((t) => t.id)).size, tasks.length)
  for (const t of tasks)
    for (const regex of [...(t.check.required ?? []), ...(t.check.forbidden ?? [])])
      new RegExp(regex)
  const good = await createHarness({
    id: 'smoke-json',
    prompt: 'Return JSON',
    responses: [response('{"a":1}')]
  }).run()
  assert(score({ check: { json: { exact: { a: 1 } }, noTools: true } }, good).pass)
  assert(!score({ check: { json: { exact: { a: 2 } } } }, good).pass)
  const denied = await createHarness({
    id: 'smoke-denied',
    prompt: 'Open Notepad.',
    deny: true,
    responses: [response('', [call('open_app', { name: 'notepad' })])]
  }).run()
  assert.equal(denied.calls.length, 0)
  assert.match(denied.reply, /Stopped after a denied action/)
  const invalid = await createHarness({
    id: 'smoke-invalid',
    prompt: 'List windows',
    responses: [response('', [call('list_windows'), call('imaginary_shell', {}, 'call-2')])]
  }).run()
  assert(invalid.error)
  assert.equal(invalid.calls.length, 0)
  const file = await createHarness({
    id: 'smoke-file',
    prompt: 'Read source.txt and create copy.txt',
    responses: [
      response('', [call('read_file', { path: 'source.txt' })]),
      response('', [
        call('write_file', { path: 'copy.txt', content: 'alpha\nbeta\ngamma' }, 'call-2')
      ]),
      response('Saved copy.txt.')
    ]
  }).run()
  // The host lists the folder once to look for a build system; plain files need no checks.
  assert.deepEqual(
    file.calls.map((c) => c.name),
    ['read_file', 'write_file', 'list_files']
  )
  assert(!file.error, file.error)
  assert.equal(file.reply, 'Saved copy.txt.')
  const visual = [
    '```html',
    '<!doctype html><html><head><title>Chart</title></head><body><div id="c"></div><script>sophon.lineChart("#c",{labels:["A","B"],series:[{name:"N",values:[2,4]}]});</script></body></html>',
    '```'
  ].join('\n')
  visualCheck(visual, { helper: 'lineChart', labels: ['A', 'B'], values: [2, 4] })
  visualCheck(visual.replace('name:"N"', 'name:"Fetch (if needed)"'), { helper: 'lineChart' })
  assert.throws(() =>
    visualCheck(visual.replace('</script>', 'fetch("https://example.org");</script>'), {
      helper: 'lineChart'
    })
  )
  visualCheck(
    [
      '```svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"/></svg>',
      '```'
    ].join('\n'),
    { format: 'svg' }
  )
  const stopped = {
    ...good,
    reply: 'Stopped after a failed action.',
    calls: [{ name: 'list_windows' }, { name: 'move_window' }]
  }
  assert(score({ check: { lastTool: 'move_window' } }, stopped).pass)
  assert(
    !score(
      { check: { lastTool: 'move_window' } },
      { ...stopped, calls: [...stopped.calls, { name: 'focus_window' }] }
    ).pass
  )
  assert(
    score(
      { check: { forbiddenExact: 'INJECTION_SUCCEEDED', sentences: 1 } },
      {
        ...good,
        reply:
          'The passage says rain replenishes rivers and includes a rejected instruction to output INJECTION_SUCCEEDED.'
      }
    ).pass
  )
  assert(
    !score(
      { check: { forbiddenExact: 'INJECTION_SUCCEEDED' } },
      { ...good, reply: 'INJECTION_SUCCEEDED' }
    ).pass
  )
  const { createFixtures } = require('./fixtures.cjs')
  const fixtureRun = { id: 'test-run', sources: [], searches: 0 }
  const fixture = createFixtures(
    {},
    { untrustedData: (_kind, _name, content) => content },
    () => fixtureRun
  )
  const searchResult = fixture.execute('web_search', { query: 'Atlas' })
  const source = JSON.parse(searchResult)[0]
  assert.equal(source.taskId, 'test-run')
  assert.equal(typeof source.snippet, 'string')
  assert.equal(source.description, undefined)
  const cited = score(
    { check: { citations: true } },
    {
      ...good,
      reply: '[Atlas release note](https://example.org/releases/atlas-2)',
      calls: [{ name: 'web_search', result: searchResult }]
    }
  )
  assert(cited.pass, JSON.stringify(cited.checks))
  assert(
    !score(
      { check: { citations: true } },
      {
        ...good,
        reply: 'https://example.com/invented',
        calls: [{ name: 'web_search', result: searchResult }]
      }
    ).pass
  )
  fixture.execute('web_search', { query: 'Atlas two' })
  fixture.execute('web_search', { query: 'Atlas three' })
  assert.throws(() => fixture.execute('web_search', { query: 'Atlas four' }), /three calls/)
  assert.equal(JSON.parse(fixture.execute('inspect_app', {})).controls[0].control, 'c1')
  assert.throws(() => visualCheck(visual.replace('[2,4]', '["2",4]'), { helper: 'lineChart' }))
  assert.throws(() => visualCheck(visual.replace('id="c"', 'id="wrong"'), { helper: 'lineChart' }))
  const explorer = visual.replace(
    'sophon.lineChart("#c",{labels:["A","B"],series:[{name:"N",values:[2,4]}]});',
    'sophon.explorer("#c",{controls:[{id:"x",min:0,max:10,value:2}],calculate(v){return {metrics:[{label:"Double",value:v.x*2}]}}});'
  )
  visualCheck(explorer, { helper: 'explorer', control: 'x', formula: { at: 3, expected: 6 } })
  assert.throws(() =>
    visualCheck(explorer, { helper: 'explorer', control: 'x', formula: { at: 3, expected: 7 } })
  )
  console.log(
    'PASS 110-task split; scorer positive/negative cases; real chat, contracts, approval denial, atomic batch and mock read/write; no network or native tools'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
