export const browserSchemas = [
  {
    type: 'function',
    function: {
      name: 'browser_open',
      description:
        "Open an HTTP(S) page in a visible Sophon-managed Edge or Chrome profile. This is a separate login session, not the user's existing browser or desktop app. Do not switch an explicitly requested account/session silently. The user signs in directly in the browser. Returns a task-scoped tab reference. No arbitrary scripts, extensions, cookie access or debugging endpoints.",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', maxLength: 2000 },
          browser: {
            type: 'string',
            enum: ['msedge', 'chrome'],
            description: 'Installed browser; defaults to Edge. Never installs a browser.'
          },
          tab: {
            type: 'string',
            description: 'Optional current tab reference to navigate; otherwise opens a new tab.'
          }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_tabs',
      description:
        "List only Sophon-managed browser tabs and their fresh references. Does not inspect the user's regular browser or launch anything. An empty result means no managed session; use desktop accessibility for an existing app, or browser_open when a separate session fits the request.",
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_inspect',
      description:
        'Read visible main-frame DOM controls and bounded text in a managed browser tab. Returns short-lived element references for browser_act. Password/file fields are excluded. Use a short literal query to focus controls/text. Frames and omitted content are reported; no screenshot required.',
      parameters: {
        type: 'object',
        properties: {
          tab: { type: 'string' },
          query: { type: 'string', maxLength: 120 }
        },
        required: ['tab']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_act',
      description:
        'Use one exact element from browser_inspect: click, fill, check, uncheck, select an option by value, or press Enter. References expire after navigation, action or two minutes. fill replaces the field without submitting. Click/Enter may submit externally. Returns a fresh focused DOM read-back; assess the goal from that evidence, never blindly retry an uncertain action.',
      parameters: {
        type: 'object',
        properties: {
          observation: { type: 'string' },
          element: { type: 'string' },
          action: {
            type: 'string',
            enum: ['click', 'fill', 'check', 'uncheck', 'select', 'press_enter']
          },
          text: {
            type: 'string',
            maxLength: 4000,
            description: 'Required only for fill or select (option value).'
          },
          query: {
            type: 'string',
            maxLength: 120,
            description:
              'Optional literal query for the post-action read-back, e.g. expected channel or button name.'
          }
        },
        required: ['observation', 'element', 'action']
      }
    }
  }
]
