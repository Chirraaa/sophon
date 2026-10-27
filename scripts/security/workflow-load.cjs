const crypto = require('node:crypto')
module.exports = (load) =>
  load('src/main/workflow/controller.ts', {
    crypto,
    './coding-session': load('src/main/workflow/coding-session.ts', {
      '../llm/untrusted-data': load('src/main/llm/untrusted-data.ts', { crypto })
    }),
    '../llm/untrusted-data': load('src/main/llm/untrusted-data.ts', { crypto }),
    './results': load('src/main/workflow/results.ts')
  })
