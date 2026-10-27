module.exports = (load) => ({
  '../workflow/coding-session': load('src/main/workflow/coding-session.ts', {
    '../llm/untrusted-data': load('src/main/llm/untrusted-data.ts', {
      crypto: require('node:crypto')
    })
  }),
  '../workflow/coding-documents': { saveCodingDocuments: () => 'fixture/coding-runs' },
  '../workflow/coding-verification': load('src/main/workflow/coding-verification.ts'),
  '../harness/store': {
    HARNESS_INSTRUCTIONS: '',
    harnessContext: () => '',
    recordHarnessUse: () => {},
    readHarness: () => {
      throw Object.assign(new Error('No learned guidance in fixture'), { code: 'ENOENT' })
    }
  },
  '../tools/schemas': load('src/main/tools/schemas.ts', {
    './windows': { POSITIONS: [] },
    '../harness/schemas': load('src/main/harness/schemas.ts')
  }),
  '../../shared/questions': load('src/shared/questions.ts')
})
