const readline = require('node:readline')
const tools = [
  {
    name: 'echo',
    description: 'Echo a test message',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
      additionalProperties: false
    }
  },
  { name: 'fail', description: 'Return an application error', inputSchema: { type: 'object' } },
  { name: 'hang', description: 'Wait until cancelled', inputSchema: { type: 'object' } }
]
function answer(request) {
  switch (request.method) {
    case 'initialize':
      return {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'sophon-test', version: '1' }
      }
    case 'tools/list':
      return { tools }
    case 'tools/call':
      if (request.params.name === 'hang') return undefined
      return {
        content: [{ type: 'text', text: request.params.arguments?.message ?? 'Expected failure' }],
        isError: request.params.name === 'fail'
      }
    case 'resources/list':
      return {
        resources: [{ uri: 'test://document', name: 'Test document', mimeType: 'text/plain' }]
      }
    case 'resources/templates/list':
      return { resourceTemplates: [] }
    case 'resources/read':
      return { contents: [{ uri: 'test://document', text: 'Resource body' }] }
    case 'prompts/list':
      return { prompts: [{ name: 'review', description: 'Test prompt' }] }
    case 'prompts/get':
      return { messages: [{ role: 'user', content: { type: 'text', text: 'Review this test' } }] }
    default:
      return {}
  }
}
module.exports = { answer }
if (require.main === module) {
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const request = JSON.parse(line)
    if (request.id === undefined) return
    const result = answer(request)
    if (result !== undefined)
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n')
  })
}
