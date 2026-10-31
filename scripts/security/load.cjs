const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
let proofUserData
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
      if (
        !Object.hasOwn(dependencies, name) &&
        ['../workflow/timing', '../../workflow/timing', './timing'].includes(name)
      )
        return load('src/main/workflow/timing.ts')
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
          ...dependencies[name],
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
      // The chat loop asks every provider for model info; fixtures written when only
      // ChatGPT did may mock just callLLM. Supply "no window reported" for those.
      if (
        file === 'src/main/llm/chat.ts' &&
        name === './client' &&
        dependencies[name] &&
        !dependencies[name].getModelInfo
      )
        return Object.create(dependencies[name], {
          getModelInfo: { value: async (id) => ({ id, label: id }) }
        })
      if (['./powershell-worker', '../powershell-worker'].includes(name))
        return load('src/main/tools/powershell-worker.ts', {
          child_process: dependencies.child_process,
          crypto: dependencies.crypto ?? require('node:crypto'),
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
      if (!Object.hasOwn(dependencies, name) && name === './browser/schemas')
        return load('src/main/tools/browser/schemas.ts')
      if (
        !Object.hasOwn(dependencies, name) &&
        ['../chat/clear-request', './clear-request'].includes(name)
      )
        return load('src/main/chat/clear-request.ts')
      if (!Object.hasOwn(dependencies, name) && name === './notes-schemas')
        return load('src/main/tools/notes-schemas.ts')
      if (!Object.hasOwn(dependencies, name) && name === './timer-schemas')
        return load('src/main/tools/timer-schemas.ts', {
          '../../shared/timers': load('src/shared/timers.ts')
        })
      if (!Object.hasOwn(dependencies, name) && name === './calendar-schemas')
        return load('src/main/tools/calendar-schemas.ts')
      if (!Object.hasOwn(dependencies, name) && name === '../memory/schemas')
        return load('src/main/memory/schemas.ts')
      if (!Object.hasOwn(dependencies, name) && name === '../memory/episodes')
        return {
          recordEpisode: () => {},
          renameEpisode: () => {},
          deleteEpisode: () => {},
          pruneEpisodes: () => {}
        }
      // Chat fixtures that do not exercise memory get the tools switched off.
      if (!Object.hasOwn(dependencies, name) && name === '../memory/agent')
        return {
          memoryTools: () => [],
          isMemoryTool: (tool) => ['remember', 'forget', 'recall'].includes(tool),
          runMemoryTool: () => 'Could not save the memory: unavailable in this fixture.',
          noteRecalled: () => {}
        }

      if (
        !Object.hasOwn(dependencies, name) &&
        ['../shared/model-tuning', '../../shared/model-tuning'].includes(name)
      )
        return load('src/shared/model-tuning.ts')
      if (
        !Object.hasOwn(dependencies, name) &&
        [
          '../../shared/context-usage',
          '../../../shared/context-usage',
          '../../../../shared/context-usage'
        ].includes(name)
      )
        return load('src/shared/context-usage.ts')
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
      if (!Object.hasOwn(dependencies, name) && name === '../../shared/llama-server')
        return load('src/shared/llama-server.ts')
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
      if (!Object.hasOwn(dependencies, name) && name === './html-check')
        return load('src/main/workflow/html-check.ts', {
          parse5: require('parse5'),
          'node:vm': require('node:vm')
        })
      // Proof harness modules are pure apart from probe script files, which go to a
      // throwaway folder unless a test supplies its own electron/fs fixtures.
      const proofModule = name.match(
        /(?:^\.\/|\/proof\/)(contract|fingerprint|governor|falsifier|probe-files)$/
      )
      if (
        !Object.hasOwn(dependencies, name) &&
        proofModule &&
        (name.includes('/proof/') || file.startsWith('src/main/workflow/proof/'))
      )
        return load(`src/main/workflow/proof/${proofModule[1]}.ts`, {
          crypto: require('node:crypto'),
          fs: require('node:fs'),
          path: require('node:path'),
          electron: {
            app: {
              getPath: () =>
                (proofUserData ??= fs.mkdtempSync(
                  path.join(require('node:os').tmpdir(), 'sophon-proof-fixture-')
                ))
            }
          }
        })
      if (!Object.hasOwn(dependencies, name) && /(?:^|\/)shared\/proof$/.test(name))
        return load('src/shared/proof.ts')
      if (!Object.hasOwn(dependencies, name) && ['../security/grants', './grants'].includes(name))
        return load('src/main/security/grants.ts')
      if (!Object.hasOwn(dependencies, name) && name === '../workflow/coding-mutation')
        return load('src/main/workflow/coding-mutation.ts')
      // Desktop fixtures that do not exercise parallel agents act alone: no waiting for a turn,
      // no cursor overlay, and the pointer jumps straight to its target.
      if (!Object.hasOwn(dependencies, name) && name === '../desktop/arbiter')
        return {
          withDesktop: (_run, _options, fn) => fn(),
          WindowBusyError: class WindowBusyError extends Error {}
        }
      if (
        !Object.hasOwn(dependencies, name) &&
        ['../desktop/cursors', '../../desktop/cursors'].includes(name)
      )
        return {
          cursorMove: () => {},
          cursorPulse: () => {},
          cursorState: () => {},
          cursorRemove: () => {},
          cursorPosition: () => undefined
        }
      if (
        !Object.hasOwn(dependencies, name) &&
        ['../../shared/pointer-path', '../shared/pointer-path'].includes(name)
      )
        return load('src/shared/pointer-path.ts')
      if (
        !Object.hasOwn(dependencies, name) &&
        name === '../settings' &&
        file === 'src/main/tools/interact.ts'
      )
        return { getSettings: () => ({ agents: { pointer: 'instant' } }) }
      // Chat fixtures that do not exercise parallel agents see none available.
      if (!Object.hasOwn(dependencies, name) && name === '../chat/agents')
        return {
          AGENT_INSTRUCTIONS: '',
          AGENT_TOOLS: ['spawn_agent', 'message_agent', 'check_agents', 'stop_agent'],
          agentRolePrompt: () => '',
          agentRoster: () => undefined,
          agentToolNames: () => [],
          runAgentTool: async () => 'Parallel agents are unavailable in this fixture.'
        }
      // The run manager scopes each run to its async call chain (parallel agents).
      if (!Object.hasOwn(dependencies, name) && name === 'async_hooks')
        return require('node:async_hooks')
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
