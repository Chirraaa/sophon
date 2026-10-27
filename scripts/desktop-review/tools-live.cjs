const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')

module.exports = async ({
  evaluate,
  output,
  report,
  saveReport,
  check,
  wait,
  main,
  app,
  dialog
}) => {
  const status = await fetch('http://127.0.0.1:1234/api/v0/models').then((r) => r.json())
  const loaded = status.data.find(
    (model) => model.state === 'loaded' && model.type !== 'embeddings'
  )
  assert(loaded, 'Load a local chat model before running this suite')
  report.model = loaded.id
  report.boundary =
    'Production IPC, model transport, chat loop, validators and tool execution; isolated profile and scratch workspace; no response/tool doubles'
  const workspace = fs.mkdtempSync(path.join(os.homedir(), 'sophon-tool-test-'))
  report.workspace = workspace
  fs.writeFileSync(
    path.join(workspace, 'project-notes.txt'),
    'Project: ORION\nVerification code: 7429\n'
  )
  fs.writeFileSync(
    path.join(workspace, 'sales.csv'),
    'name,amount,region\nalpha,2.5,EU\nbeta,7.5,US\ngamma,3.5,EU\n'
  )
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] })
  const update = async (patch) => {
    const result = await evaluate(`window.api.updateSettings(${JSON.stringify(patch)})`)
    assert(result.ok, result.error)
  }
  await update({
    model: {
      modelId: loaded.id,
      contextWindow: 32000,
      maxTokens: 2048,
      maxSteps: 12,
      thinking: false,
      specialists: true
    },
    research: { enabled: true },
    memory: { enabled: true }
  })
  await evaluate('window.api.pickWorkspace()')
  assert.equal((await evaluate('window.api.getSettings()')).files.workspace, workspace)
  const filter = process.env.SOPHON_LIVE_CASES?.split(',')
  let failures = 0
  const run = async (name, prompt, verify) => {
    if (filter && !filter.includes(name)) return
    await evaluate('window.api.chats.create()')
    const startedAt = Date.now()
    console.log('RUN ' + name)
    const result = { test: name, prompt }
    report.modelReplies.push(result)
    saveReport()
    try {
      await evaluate(`window.api.send(${JSON.stringify(prompt)})`)
      const session = await evaluate('window.api.getSession()')
      result.reply = session.items.at(-1)
      result.latencyMs = Date.now() - startedAt
      assert(!/^Error:|^Stopped/i.test(result.reply.text), result.reply.text)
      await verify(result.reply)
      result.ok = true
      check(name)
    } catch (error) {
      failures++
      result.ok = false
      result.error = String(error.stack)
      console.error('FAIL ' + name + ': ' + error.message)
    }
    saveReport()
  }
  const used = (reply, name) => reply.actions.some((a) => a.name === name && a.status === 'done')
  const noDesktop = (reply) =>
    assert(
      !reply.actions.some((a) =>
        [
          'open_app',
          'click',
          'type_text',
          'press_keys',
          'look_at_screen',
          'close_app',
          'close_window'
        ].includes(a.name)
      )
    )
  for (let i = 1; i <= 3; i++)
    await run(
      'clarification-' + i,
      'I would like to start a new project around the double slit experiment.',
      async (reply) => {
        assert.match(reply.text, /```sophon-questions/)
        noDesktop(reply)
        await wait(
          () => evaluate('!!document.querySelector(\'[aria-label="Clarifying questions"]\')'),
          'live clarification card'
        )
        assert(
          await evaluate(
            'document.querySelectorAll(\'[aria-label="Clarifying questions"] button\').length >= 2'
          )
        )
        if (i === 1) {
          await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
          await delay(1000)
          fs.writeFileSync(
            path.join(output, 'live-clarification.png'),
            (
              await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
            ).toPNG()
          )
        }
      }
    )
  await run('direct-answer', 'What is 2 + 2? Answer directly.', (reply) => {
    assert.match(reply.text, /4/)
    assert.equal(reply.actions.length, 0)
    assert(!reply.text.includes('sophon-questions'))
  })
  await run(
    'calculation',
    'Calculate (1739 * 2847 + 19381) / 17 and verify the numerical result.',
    (reply) => {
      assert(used(reply, 'python_calculate'), 'Expected an executed calculation')
      assert.match(reply.text.replace(/,/g, ''), /292371/)
      noDesktop(reply)
    }
  )
  await run(
    'csv-workspace',
    'Using sales.csv in my working folder, calculate the total amount for rows whose region is EU.',
    (reply) => {
      assert(used(reply, 'python_calculate'), 'Expected a calculation over actual CSV data')
      assert.match(reply.text, /6(?:\.0)?/)
      noDesktop(reply)
    }
  )
  await run(
    'file-read',
    'Read project-notes.txt in my working folder and tell me the project name and verification code.',
    (reply) => {
      assert(used(reply, 'read_file'))
      assert.match(reply.text, /ORION/)
      assert.match(reply.text, /7429/)
      noDesktop(reply)
    }
  )
  await run('file-discovery', 'List the files in my working folder.', (reply) => {
    assert(used(reply, 'list_files'))
    assert.match(reply.text, /sales\.csv/)
  })
  await run(
    'file-write',
    'Create a new file named test-summary.txt in my working folder containing exactly: ORION verified 7429',
    (reply) => {
      assert(used(reply, 'write_file'))
      assert.equal(
        fs.readFileSync(path.join(workspace, 'test-summary.txt'), 'utf8').trim(),
        'ORION verified 7429'
      )
    }
  )
  await run(
    'inline-visual',
    'Show a simple interactive double-slit diagram inline with a working slider for slit spacing. Use illustrative data and label it. Do not save files.',
    (reply) => {
      assert.match(reply.text, /```html/)
      assert.match(reply.text, /type=["']range["']|sophon\.explorer/)
      assert(!reply.actions.some((a) => !['consult_specialist'].includes(a.name)))
    }
  )
  await run(
    'web-page',
    'Read https://example.com and tell me the heading on the page. Include the source link.',
    (reply) => {
      assert(used(reply, 'web_fetch'))
      assert.match(reply.text, /Example Domain/i)
      assert.match(reply.text, /https:\/\/example\.com/)
      noDesktop(reply)
    }
  )
  await run(
    'capability-question',
    'Can you open apps, read files and calculate CSV totals? Just explain your capabilities.',
    (reply) => {
      assert.equal(reply.actions.length, 0)
      assert(!reply.text.includes('sophon-questions'))
    }
  )
  await run(
    'procedural-recall',
    'List the procedural skills available in your harness. Do not change or save anything.',
    (reply) => {
      assert(used(reply, 'harness_manage'))
      assert(
        reply.actions
          .filter((a) => a.name === 'harness_manage')
          .every((a) => !/Composed |Archived /i.test(a.detail ?? ''))
      )
    }
  )
  await run('wait', 'Wait 0.1 seconds, then reply with ready.', (reply) => {
    assert(used(reply, 'wait'))
    assert.match(reply.text, /ready/i)
  })
  await run(
    'app-discovery',
    'Find installed apps matching Notepad. List their names; do not launch anything.',
    (reply) => {
      assert(used(reply, 'list_apps'))
      assert(!reply.actions.some((a) => a.name === 'open_app'))
      assert.match(reply.text, /notepad/i)
    }
  )
  await run(
    'specialist-review',
    'Use your reviewer specialist to check this claim: the average of 2, 4 and 12 is 9. Explain the correction in two sentences.',
    (reply) => {
      assert(
        reply.specialists?.some(
          (specialist) => specialist.profile === 'reviewer' && specialist.status === 'done'
        )
      )
      assert.match(reply.text, /6/)
      noDesktop(reply)
    }
  )
  await run(
    'web-search',
    'Search the public web for the official Python documentation on fractions.Fraction, read the relevant source and briefly explain exact rational arithmetic with a clickable citation. Do not open a browser.',
    (reply) => {
      assert(used(reply, 'web_search'))
      assert(used(reply, 'web_fetch'))
      assert.match(reply.text, /https:\/\/docs\.python\.org\//)
      noDesktop(reply)
    }
  )
  await run(
    'procedural-save',
    'Save a reusable procedural skill named fixture-verification in your harness: when checking a test fixture, compare its observed identifier with the expected identifier before claiming success. Source: explicit instruction in this isolated test. Applies to: test fixture verification. Limits: not proof about other fixtures. Use propose, probe and compose; this is procedural guidance, not a personal memory.',
    (reply) => {
      assert(used(reply, 'harness_manage'))
      const file = path.join(app.getPath('userData'), 'harness/skills/fixture-verification.md')
      assert(fs.existsSync(file), 'The skill must actually be composed in the isolated profile')
      assert.match(fs.readFileSync(file, 'utf8'), /identifier/)
      const actions = reply.actions.filter((action) => action.name === 'harness_manage')
      const composed = actions.findIndex((action) =>
        /Composed skills\/fixture-verification/.test(action.detail ?? '')
      )
      assert(composed >= 2, 'Compose must follow propose and a passing probe')
      assert(actions.slice(0, composed).some((action) => /probe passed/i.test(action.detail ?? '')))
    }
  )
  await update({ tools: { python_calculate: 'block' } })
  for (let i = 1; i <= 3; i++)
    await run(
      'blocked-calculation-' + i,
      'Use python_calculate to compute 17 * 23. If it is unavailable, tell me; do not use another tool.',
      (reply) => {
        assert.equal(reply.actions.length, 0)
        assert.match(reply.text, /unavailable|not available|disabled|cannot|blocked/i)
      }
    )
  await update({ tools: { python_calculate: 'allow' } })
  report.failedCases = failures
  report.profile = app.getPath('userData')
  saveReport()
  fs.writeFileSync(path.join(output, 'tools-live-summary.json'), JSON.stringify(report, null, 2))
  assert.equal(failures, 0, `${failures} live tool-usage cases failed; see ${output}`)
}
