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
      name: 'verification_contract',
      description:
        'State what "done" means as falsifiable claims, each tested by executable probes, before you edit. claims: behavior (the change must make it true), guard (must stay true, such as existing tests or typecheck) or manual (cannot be automated; reported as unverified). probes: exactly one of command (one PowerShell check command) or script ({language: node|python, source}); a probe exits 0 when its claim holds. Node scripts are ES modules run from the probe folder; import workspace code with await import(workspace("src/x.js")). Script probes are stored by the app, not in the project. files lists test files a probe depends on. The user approves new probes once; after that the host re-runs them freely (run_probes) at no approval cost. The host runs new probes immediately: a behavior probe should FAIL now and pass after your change; that red-to-green transition with unchanged probe and test files is a witness. A probe that already passes cannot witness the change. Call again to add or redefine probes (redefining resets its history) or withdraw a claim/probe with a reason; amendments appear in the final proof. Submit alone, not mixed with other calls.',
      parameters: {
        type: 'object',
        properties: {
          claims: {
            type: 'array',
            maxItems: 16,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$' },
                text: { type: 'string', maxLength: 300 },
                kind: { type: 'string', enum: ['behavior', 'guard', 'manual'] }
              },
              required: ['id', 'text', 'kind']
            }
          },
          probes: {
            type: 'array',
            maxItems: 16,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$' },
                claim: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$' },
                command: { type: 'string', maxLength: 2000 },
                script: {
                  type: 'object',
                  properties: {
                    language: { type: 'string', enum: ['node', 'python'] },
                    source: { type: 'string', maxLength: 6000 }
                  },
                  required: ['language', 'source']
                },
                path: { type: 'string', maxLength: 400 },
                files: {
                  type: 'array',
                  maxItems: 8,
                  items: { type: 'string', maxLength: 400 }
                },
                timeout_seconds: { type: 'number' }
              },
              required: ['id', 'claim']
            }
          },
          withdraw: {
            type: 'array',
            maxItems: 16,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', maxLength: 32 },
                reason: { type: 'string', maxLength: 300 }
              },
              required: ['id', 'reason']
            }
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_probes',
      description:
        'Re-run approved verification probes on the current code without asking the user again. Omit ids to run every probe whose last result is stale (code changed since) or missing; pass ids to run specific probes. Returns each probe as green, red (with normalized diagnostics) or unapproved, plus witness status. Use it after each fix instead of guessing; it does not count against the action budget.',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            maxItems: 16,
            uniqueItems: true,
            items: { type: 'string', maxLength: 32 }
          }
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
