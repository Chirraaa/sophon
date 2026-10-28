const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
function load(file, dependencies = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', '__dirname', 'process', code)(
    (name) => {
      if (
        !Object.hasOwn(dependencies, name) &&
        name.endsWith('/results') &&
        name.includes('workflow')
      )
        return load('src/main/workflow/results.ts')
      if (!Object.hasOwn(dependencies, name) && name.endsWith('/tool-outcome'))
        return load('src/main/workflow/tool-outcome.ts', {
          './results': load('src/main/workflow/results.ts')
        })
      if (!Object.hasOwn(dependencies, name) && name.endsWith('/action-ledger'))
        return load('src/main/workflow/action-ledger.ts')
      if (!Object.hasOwn(dependencies, name) && name === '../workflow/runtime')
        return load('src/main/workflow/runtime.ts', {
          './controller':
            dependencies['../workflow/controller'] ?? require('./workflow-load.cjs')(load),
          './coding-session':
            dependencies['../workflow/coding-session'] ??
            load('src/main/workflow/coding-session.ts', {
              '../llm/untrusted-data': load('src/main/llm/untrusted-data.ts', {
                crypto: require('node:crypto')
              })
            }),
          './coding-verification':
            dependencies['../workflow/coding-verification'] ??
            load('src/main/workflow/coding-verification.ts')
        })
      // Old scripted model fixtures describe tool text. Adapt those at their
      // external boundary; production chat and runtime receive typed outcomes.
      if (
        file === 'src/main/llm/chat.ts' &&
        source.includes("from '../workflow/runtime'") &&
        name === './run-tool' &&
        dependencies[name]
      ) {
        const { normalizeToolOutcome } = load('src/main/workflow/tool-outcome.ts', {
          './results': load('src/main/workflow/results.ts')
        })
        return {
          runTool: async (tool, args, ...rest) => {
            const result = await dependencies[name].runTool(tool, args, ...rest)
            const outcome = normalizeToolOutcome(tool, args, result)
            if (tool !== 'inspect_app' || outcome.observation || outcome.status !== 'observed')
              return outcome
            try {
              const envelope = JSON.parse(outcome.text)
              const snapshot = JSON.parse(envelope.content)
              if (envelope.kind === 'app-controls' && snapshot.windowRef && snapshot.observation)
                return {
                  ...outcome,
                  observation: {
                    id: snapshot.observation,
                    windowRef: snapshot.windowRef,
                    expiresAt: Date.now() + 120000,
                    controls: snapshot.controls.length
                  }
                }
            } catch {
              /* Non-accessibility fixture result. */
            }
            return outcome
          }
        }
      }
      if (['./powershell-worker', '../powershell-worker'].includes(name))
        return load('src/main/tools/powershell-worker.ts', {
          child_process: dependencies.child_process,
          path: dependencies.path,
          '../security/worker-job':
            dependencies['../security/worker-job'] ?? dependencies['../../security/worker-job']
        })
      if (
        !Object.hasOwn(dependencies, name) &&
        (name === '../plugins/skills' ||
          (name === './skills' && file.startsWith('src/main/plugins/')))
      )
        return load('src/main/plugins/skills.ts', { crypto: require('node:crypto') })
      if (!Object.hasOwn(dependencies, name) && name === './coding-mutation')
        return load('src/main/workflow/coding-mutation.ts')
      if (!Object.hasOwn(dependencies, name) && name === './tool-discovery')
        return load('src/main/llm/tool-discovery.ts')
      if (!Object.hasOwn(dependencies, name) && name === './app-routing')
        return load('src/main/llm/app-routing.ts')
      if (!Object.hasOwn(dependencies, name) && name === '../plugins/schemas')
        return load('src/main/plugins/schemas.ts')

      if (
        !Object.hasOwn(dependencies, name) &&
        ['../shared/model-tuning', '../../shared/model-tuning'].includes(name)
      )
        return load('src/shared/model-tuning.ts')
      if (!Object.hasOwn(dependencies, name) && name === '../../shared/coding-resources')
        return load('src/shared/coding-resources.ts')
      if (!Object.hasOwn(dependencies, name) && name === '../../shared/model-capabilities')
        return load('src/shared/model-capabilities.ts')
      if (!Object.hasOwn(dependencies, name) && name === '../../shared/model-usage')
        return load('src/shared/model-usage.ts')
      if (!Object.hasOwn(dependencies, name) && name === './retention')
        return load('src/main/llm/retention.ts')
      if (!Object.hasOwn(dependencies, name) && name === './compaction') {
        const untrusted = load('src/main/llm/untrusted-data.ts', { crypto: require('node:crypto') })
        return load('src/main/llm/compaction.ts', {
          './context': load('src/main/llm/context.ts', { './untrusted-data': untrusted }),
          './untrusted-data': untrusted
        })
      }
      if (!Object.hasOwn(dependencies, name) && name === '../../shared/coding-quality')
        return load('src/shared/coding-quality.ts')
      if (!Object.hasOwn(dependencies, name) && name === '../../shared/github-context')
        return load('src/shared/github-context.ts')
      if (!Object.hasOwn(dependencies, name) && name === '../../shared/github-history')
        return load('src/shared/github-history.ts')
      if (!Object.hasOwn(dependencies, name) && name === './github-history')
        return load('src/main/plugins/github-history.ts')
      if (file === 'src/shared/coding-quality.ts' && name === './coding-examples')
        return load('src/shared/coding-examples.ts')
      if (!Object.hasOwn(dependencies, name) && name.endsWith('/loop-budgets'))
        return load('src/main/workflow/loop-budgets.ts')
      if (!Object.hasOwn(dependencies, name) && name.endsWith('/loop-limits'))
        return load('src/shared/loop-limits.ts')
      assert(Object.hasOwn(dependencies, name), `Unexpected dependency in ${file}: ${name}`)
      return dependencies[name]
    },
    module,
    module.exports,
    path.dirname(path.join(root, file)),
    dependencies.__process ?? process
  )
  return module.exports
}
module.exports = { load, root }
