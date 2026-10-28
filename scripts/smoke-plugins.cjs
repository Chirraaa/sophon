const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const http = require('node:http')
const { load, root } = require('./security/load.cjs')
const { answer } = require('./fixtures/mcp-server.cjs')
const directory = fs.mkdtempSync(path.join(root, '.cache/plugins-'))
const config = load('src/main/plugins/config.ts')
const importer = load('src/main/plugins/import.ts', { fs, path, './config': config })
const electron = {
  app: { isPackaged: false, getAppPath: () => root, getPath: () => directory },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(Buffer.from(text).toString('base64')),
    decryptString: (bytes) => Buffer.from(bytes.toString(), 'base64').toString()
  }
}
const storeDeps = { electron, fs, path, crypto, './import': importer, './config': config }
const store = load('src/main/plugins/store.ts', storeDeps)
const sdk = {
  '@modelcontextprotocol/sdk/client/index.js': require('@modelcontextprotocol/sdk/client/index.js'),
  '@modelcontextprotocol/sdk/client/stdio.js': require('@modelcontextprotocol/sdk/client/stdio.js'),
  '@modelcontextprotocol/sdk/client/streamableHttp.js': require('@modelcontextprotocol/sdk/client/streamableHttp.js')
}
const runtime = load('src/main/plugins/runtime.ts', {
  ...sdk,
  './store': store,
  '../security/worker-job': load('src/main/security/worker-job.ts', { koffi: require('koffi') })
})
const runManager = { assertRun: (run) => run.signal.throwIfAborted() }
const pluginTools = load('src/main/plugins/tools.ts', {
  './store': store,
  './runtime': runtime,
  './config': config,
  '@modelcontextprotocol/sdk/validation/ajv': require('@modelcontextprotocol/sdk/validation/ajv'),
  '../llm/untrusted-data': load('src/main/llm/untrusted-data.ts', { crypto }),
  '../security/run-manager': runManager
})
const run = () => ({ signal: new AbortController().signal })
const decode = (text) => JSON.parse(JSON.parse(text).content)
const fixture = path.join(root, 'scripts/fixtures/mcp-server.cjs')
let server
async function main() {
  assert.equal(config.parseMcpConfig({ command: 'node', args: ['server.js'] }).type, 'stdio')
  for (const url of [
    'file:///secret',
    'http://example.com/mcp',
    'https://user:password@example.com/mcp',
    'https://example.com/mcp?token=secret'
  ])
    assert.throws(() => config.parseMcpConfig({ type: 'http', url }))
  assert.throws(() => config.parseMcpConfig({ command: 'node', args: 'server.js' }))
  assert.throws(() =>
    config.parseMcpConfig({
      type: 'http',
      url: 'https://example.com',
      headers: { Authorization: 'bad\r\nheader' }
    })
  )
  assert.throws(() => config.parseCallArguments('[]'))
  assert.throws(() => config.parseCallArguments('{"unterminated":'))
  assert.deepEqual(store.pluginSummaries(), [], 'Fresh profiles have no installed plugins')
  assert.deepEqual(store.serverSummaries(), [], 'Fresh profiles have no MCP connections')
  const packageFolder = path.join(directory, 'fixture-plugin')
  fs.mkdirSync(path.join(packageFolder, '.claude-plugin'), { recursive: true })
  fs.mkdirSync(path.join(packageFolder, 'skills', 'example'), { recursive: true })
  fs.writeFileSync(
    path.join(packageFolder, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'Sophon test fixture', version: '1.0.0' })
  )
  fs.writeFileSync(
    path.join(packageFolder, 'skills', 'example', 'SKILL.md'),
    '---\nname: example\ndescription: Exercise plugin imports in isolated tests.\n---\n\nUse the fixture tool.'
  )
  fs.writeFileSync(
    path.join(packageFolder, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        fixture: { command: process.execPath, args: [fixture] },
        placeholder: { command: 'node', args: ['${FIXTURE_SERVER}'] }
      }
    })
  )
  const imported = importer.readPlugin(packageFolder)
  assert.equal(Object.keys(imported.documents).filter((p) => p.endsWith('/SKILL.md')).length, 1)
  assert(imported.servers.some((s) => s.name === 'fixture'))
  assert(imported.warnings.some((w) => w.includes('placeholder')))
  store.importPlugin(imported)
  const plugins = store.pluginSummaries()
  const indexed = plugins.flatMap((p) => p.skills ?? [])
  assert.equal(indexed.length, 1, 'Imported entrypoint skills have a discoverable index')
  assert(
    indexed.every(
      (s) =>
        s.id.startsWith('plugin/') &&
        s.id.length <= 100 &&
        s.name &&
        s.description &&
        s.path.endsWith('/SKILL.md')
    )
  )
  assert.equal(new Set(indexed.map((s) => s.id)).size, indexed.length)
  assert.deepEqual(
    store.pluginSummaries().flatMap((p) => p.skills),
    indexed,
    'Skill IDs remain stable across reads'
  )
  assert.equal(plugins.length, 1)
  assert(plugins.every((p) => !p.enabled))
  assert(store.serverSummaries().every((s) => !s.enabled))
  const githubConfig = {
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: { Authorization: 'Bearer identity-fixture' }
  }
  store.addServer('Saved GitHub', githubConfig)
  const githubId = store.serverSummaries().find((server) => server.name === 'Saved GitHub').id
  store.setGithubIdentity(githubId, 'octocat', githubConfig)
  const reloaded = load('src/main/plugins/store.ts', storeDeps)
  assert.equal(
    reloaded.serverSummaries().find((server) => server.id === githubId).githubLogin,
    'octocat',
    'Username survives a restart while disconnected'
  )
  assert.equal(reloaded.serverSummaries().find((server) => server.id === githubId).enabled, false)
  assert.throws(
    () =>
      store.setGithubIdentity(githubId, 'someone-else', {
        ...githubConfig,
        headers: { Authorization: 'Bearer different-token' }
      }),
    /changed/
  )
  store.updateServer(githubId, 'Saved GitHub', {
    ...githubConfig,
    headers: { Authorization: 'Bearer changed-token' }
  })
  assert.equal(
    store.serverSummaries().find((server) => server.id === githubId).githubLogin,
    undefined,
    'Changing credentials clears the old username'
  )
  store.removeServer(githubId)
  const plugin = plugins[0]
  assert.throws(() => store.readPluginDocument(plugin.id, plugin.documents[0]))
  store.enablePlugin(plugin.id, true)
  assert(store.readPluginDocument(plugin.id, plugin.documents[0]).length > 0)
  assert.throws(() => store.readPluginDocument(plugin.id, '../registry.enc'))
  assert.throws(() => store.readPluginDocument(plugin.id, '__proto__'))
  assert.throws(() => store.importPlugin(importer.readPlugin(packageFolder)), /already imported/)

  const linked = path.join(directory, 'linked-plugin')
  fs.mkdirSync(path.join(linked, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(
    path.join(linked, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'linked' })
  )
  fs.symlinkSync(path.join(root, 'docs'), path.join(linked, 'skills'), 'junction')
  assert.throws(() => importer.readPlugin(linked), /Linked/)
  fs.unlinkSync(path.join(linked, 'skills'))
  console.log(
    'PASS plugin imports, fixture skills, placeholder handling, disabled defaults and path confinement'
  )

  store.addServer('Local fixture', {
    type: 'stdio',
    command: process.execPath,
    args: [fixture],
    env: { TEST_SECRET: 'sophon-fixture-secret' }
  })
  const local = store.serverSummaries().find((s) => s.name === 'Local fixture').id
  assert.throws(() => store.serverRecord(local), /disabled/)
  store.enableServer(local, true)
  await runtime.connectServer(local)
  assert.equal(runtime.connected(local).tools.length, 3)
  const catalogue = decode(
    await pluginTools.executePluginTool('mcp_catalog', { server: local, kind: 'tools' }, run())
  )
  assert.equal(catalogue.tools[0].name, 'echo')
  const args = { server: local, tool: 'echo', arguments_json: '{"message":"hello"}' }
  const bound = pluginTools.bindPluginAction('mcp_call', args)
  bound.revalidate()
  assert.throws(
    () => pluginTools.bindPluginAction('mcp_call', { ...args, arguments_json: '{"message":5}' }),
    /schema/
  )
  assert.throws(
    () => pluginTools.bindPluginAction('mcp_call', { ...args, tool: 'invented' }),
    /Unknown/
  )
  assert.equal(
    decode(await pluginTools.executePluginTool('mcp_call', args, run())).content[0].text,
    'hello'
  )
  assert.equal(
    decode(
      await pluginTools.executePluginTool(
        'mcp_read',
        { server: local, kind: 'resource', target: 'test://document' },
        run()
      )
    ).contents[0].text,
    'Resource body'
  )
  assert.equal(
    decode(
      await pluginTools.executePluginTool(
        'mcp_read',
        { server: local, kind: 'prompt', target: 'review' },
        run()
      )
    ).messages[0].role,
    'user'
  )
  const failure = await pluginTools.executePluginTool(
    'mcp_call',
    { ...args, tool: 'fail', arguments_json: '{}' },
    run()
  )
  assert(failure.startsWith('Tool error:'))
  assert(
    !runtime
      .safeResult(local, { content: 'sophon-fixture-secret' })
      .includes('sophon-fixture-secret')
  )
  assert(!JSON.stringify(store.serverSummaries()).includes('sophon-fixture-secret'))
  assert(
    !fs.readFileSync(path.join(directory, 'plugins/registry.enc')).includes('sophon-fixture-secret')
  )
  const restored = load('src/main/plugins/store.ts', storeDeps)
  assert.equal(restored.serverRecord(local).config.env.TEST_SECRET, 'sophon-fixture-secret')

  let invoked = 0
  let approvals = 0
  let decision = 'deny'
  const activeRun = run()
  const execute = load('src/main/llm/run-tool.ts', {
    '../tools': {
      executeTool: async () => {
        invoked++
        return 'done'
      }
    },
    '../permissions': {
      toolPermission: () => 'allow',
      requestApproval: async () => {
        approvals++
        return decision
      }
    },
    '../security/policy': { authorizeTool: () => {} },
    '../security/run-manager': {
      ...runManager,
      currentRun: () => activeRun,
      consumeToolBudget: () => {}
    },
    '../security/tool-contracts': {
      validateToolArguments: (_name, input) => structuredClone(input)
    },
    '../security/audit': { securityEvent: () => {} },
    '../security/local-action': {
      bindLocalAction: async () => ({
        preview: JSON.stringify(bound.preview),
        revalidate: bound.revalidate,
        scope: {}
      })
    },
    '../services/screen-glow': { hideScreenGlow: () => {} },
    '../settings': {
      getSettings: () => ({}),
      allowApprovedTool: () => {
        throw new Error('Must not grant permanent MCP access')
      }
    },
    '../harness/store': {}
  })
  assert.match((await execute.runTool('mcp_call', args, 'one')).text, /Denied/)
  assert.equal(invoked, 0)
  decision = 'once'
  assert.equal((await execute.runTool('mcp_call', args, 'two')).text, 'done')
  assert.equal(invoked, 1)
  assert.equal(approvals, 2, 'MCP must ask even when the generic permission is allow')
  const controller = new AbortController()
  const pending = pluginTools.executePluginTool(
    'mcp_call',
    { ...args, tool: 'hang', arguments_json: '{}' },
    { signal: controller.signal }
  )
  setTimeout(() => controller.abort(new Error('test cancelled')), 100)
  await assert.rejects(pending, /test cancelled/)
  assert.throws(() => runtime.connected(local), /Connect/)
  assert.throws(bound.revalidate, /Connect/)
  console.log(
    'PASS real stdio MCP discovery, tools, resources, prompts, input schemas, redaction, one-use approval, cancellation and stale bindings'
  )

  let credentials
  let redirectTargetHits = 0
  server = http.createServer(async (req, res) => {
    if (req.url === '/redirected') {
      redirectTargetHits++
      res.writeHead(500).end()
      return
    }
    if (req.url === '/redirect') {
      res.writeHead(307, { Location: '/redirected' }).end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    credentials = req.headers.authorization
    let body = ''
    for await (const part of req) body += part
    const request = JSON.parse(body)
    if (request.id === undefined) {
      res.writeHead(202).end()
      return
    }
    const result = answer(request)
    res
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`
  store.addServer('HTTP fixture', {
    type: 'http',
    url: endpoint,
    headers: { Authorization: 'Bearer fixture-token' }
  })
  const remote = store.serverSummaries().find((s) => s.name === 'HTTP fixture').id
  store.enableServer(remote, true)
  await runtime.connectServer(remote)
  assert.equal(runtime.connected(remote).tools.length, 3)
  assert.equal(credentials, 'Bearer fixture-token')
  assert.equal(
    decode(await pluginTools.executePluginTool('mcp_call', { ...args, server: remote }, run()))
      .content[0].text,
    'hello'
  )
  const fetcher = runtime.endpointFetch(endpoint, new AbortController().signal)
  await assert.rejects(fetcher(endpoint.replace('/mcp', '/redirected')), /configured endpoint/)
  const redirect = endpoint.replace('/mcp', '/redirect')
  await assert.rejects(
    runtime.endpointFetch(redirect, new AbortController().signal)(redirect, {
      headers: { Authorization: 'Bearer fixture-token' }
    })
  )
  assert.equal(redirectTargetHits, 0)
  await runtime.disconnect(remote)
  store.updateServer(remote, 'Changed endpoint', { type: 'http', url: endpoint })
  assert.equal(store.serverRecord(remote, false).enabled, false)
  assert.equal(store.serverRecord(remote, false).config.headers, undefined)
  console.log(
    'PASS real HTTP MCP handshake/calls, scoped authorization, redirect blocking and credential replacement'
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await runtime.closeConnections()
    if (server) {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }

    fs.rmSync(directory, { recursive: true, force: true })
  })
