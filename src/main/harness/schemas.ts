export const harnessSchemas = [
  {
    type: 'function',
    function: {
      name: 'coding_resources',
      description:
        'Inspect coding capacity with {} or request edit_chars/read_chars with a short reason. Adjusts working sizes for this run only, within user preferences, current context/output capacity and application ceilings. Read sizes are enforced; edit sizes are recommendations and valid larger patches remain accepted. Does not change model settings, permissions, task scope or total action/model-call budgets. Requests beyond capacity are clamped with an explanation; no user approval is needed for routine adjustments.',
      parameters: {
        type: 'object',
        properties: {
          edit_chars: { type: 'number', minimum: 1, maximum: 65536 },
          read_chars: { type: 'number', minimum: 1, maximum: 60000 },
          reason: { type: 'string', maxLength: 200 }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'coding_checkpoint',
      description:
        'Maintain the coding plan and checkpoint. Inspect the workspace first. Supply plan, docs (installed versions and documentation evidence or explicit limits), and tasks on the first call. Task IDs are stable; dependencies must refer to earlier tasks. Map each task to available tools, skill (or none), and profile (main or an available specialist). Use pending, active, implemented; only the application can mark verified after checks. Preserve completed tasks when updating the plan. Checkpoint after each small task with decisions and next steps. lesson is a reusable candidate with evidence, never automatic permission to publish. Saves PLAN.md, TASKS.md, DOCS.md, STATE.md, DECISIONS.md and TRACE.md in the app coding-runs directory; does not edit project files.',
      parameters: {
        type: 'object',
        properties: {
          plan: { type: 'string', maxLength: 2000 },
          docs: {
            type: 'string',
            maxLength: 2000,
            description:
              'Observed stack/version evidence and official sources, or an explicit lookup limit. If omitted or blank, the host records that no documentation evidence is available. Never invent documentation research.'
          },
          decisions: { type: 'string', maxLength: 2000 },
          lesson: { type: 'string', maxLength: 1000 },
          tasks: {
            type: 'array',
            description:
              'Use one working task for a small feature. Include scaffold, implementation and test setup in that task; task boundaries run verification, so avoid a separate unfinished npm-init task. Map every needed tool to the active task.',
            minItems: 1,
            maxItems: 12,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$' },
                title: { type: 'string', maxLength: 200 },
                dependsOn: {
                  type: 'array',
                  maxItems: 12,
                  uniqueItems: true,
                  items: { type: 'string', maxLength: 32 }
                },
                tools: {
                  type: 'array',
                  maxItems: 10,
                  uniqueItems: true,
                  items: { type: 'string', maxLength: 80 }
                },
                skill: {
                  type: 'string',
                  maxLength: 100,
                  description:
                    'Use "none" unless assigning guidance already read in this task. Use its exact category/name after harness_manage read, or the plugin skill ID returned by plugins_list/plugin_read. Framework and tool names such as nextjs or npm are not skill identifiers.'
                },
                profile: {
                  type: 'string',
                  enum: ['main', 'reviewer', 'researcher', 'tutor', 'visual_explainer']
                },
                status: { type: 'string', enum: ['pending', 'active', 'implemented'] }
              },
              required: ['id', 'title', 'dependsOn', 'tools', 'skill', 'profile', 'status']
            }
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'harness_manage',
      description:
        'Discover or read saved procedural guidance. Relevant guidance is already recalled automatically. List with {"action":"list"}; read with {"action":"read","category":"skills","name":"learning"}. Use exact category and slug from the catalog, without a folder or .md extension. This tool does not perform desktop tasks or read personal memories. Save a reusable lesson only from explicit corrections or repeatable evidence: propose content with heading, Source:, Applies to:, Limits:, then probe and compose. Script-tools need one fenced python expression and an expected JSON result during probe. Other documents require approval of the exact content after probing; the app requests it. Composed entries are unproven trials; host-observed usage determines promotion. status shows lifecycle and counters; discard invalidates a candidate; archive deprecates guidance; rollback restores an archived state. Guidance cannot change permissions. No private personal data.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'list',
              'read',
              'propose',
              'probe',
              'compose',
              'archive',
              'status',
              'discard',
              'rollback'
            ]
          },
          category: { type: 'string', enum: ['skills', 'script-tools', 'subagents', 'loop-hooks'] },
          name: {
            type: 'string',
            pattern: '^[a-z][a-z0-9-]{0,47}$',
            maxLength: 48,
            description:
              'Exact document slug, e.g. learning. No directory, spaces or .md extension. Required for every action except list.'
          },
          content: { type: 'string' },
          expected: { type: 'string' },
          csv: { type: 'string' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'python_calculate',
      description:
        'Deterministic bounded Python expressions for calculations and CSV filtering/aggregation. Supply expression or a saved script-tools recipe name. Optional headered CSV via relative workspace path or inline content. File bytes go directly to Python, not model context. Supports rows, comprehensions, sum/min/max/len/sorted, int/float/round/abs, Decimal/Fraction, sqrt/sin/cos/log/pi. No imports, attributes or arbitrary scripts. Limits: 10000 rows, 10 seconds, 512000 CSV bytes.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string' },
          recipe: { type: 'string' },
          path: { type: 'string' },
          content: { type: 'string', description: 'Optional headered CSV text.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_questions',
      description:
        'Pause and show native tappable questions when consequential ambiguity warrants clarification, including an unspecified outcome for a new project. Use this tool instead of a prose questionnaire or numbered clarification menu. Do not use for direct questions, when context already answers them, or when a useful assumption suffices. One to three questions; each has title and two to four options. User can skip or type freely.',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', maxLength: 200 },
                options: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 4,
                  uniqueItems: true,
                  items: { type: 'string', maxLength: 100 }
                }
              },
              required: ['title', 'options']
            }
          }
        },
        required: ['questions']
      }
    }
  }
]
