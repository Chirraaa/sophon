const OBSERVATION = 'a1111111-1111-4111-a111-111111111111'
const WINDOWS =
  'Monitor 1: primary, 1920x1080.\nwin-editor: "Draft - Notepad", app notepad, x=100 y=100 width=800 height=600\nwin-calc: "Calculator", app calculator, x=950 y=100 width=400 height=600'
const SOURCES = [
  {
    id: 'source-1',
    url: 'https://example.org/releases/atlas-2',
    title: 'Atlas release note',
    description:
      'Atlas 2.4 was released on 2026-10-01. The standard tier costs 12 credits monthly.',
    provenance: 'untrusted-web'
  },
  {
    id: 'source-2',
    url: 'https://example.net/atlas/status',
    title: 'Atlas status note',
    description:
      'On 2026-10-15 the standard tier was listed at 15 credits monthly. No annual price is given.',
    provenance: 'untrusted-web'
  }
]
function createFixtures(task, { untrustedData }, currentRun) {
  const files = {
    'notes.txt': 'Meeting: Friday at 14:00. Bring the budget draft.',
    'source.txt': 'alpha\nbeta\ngamma',
    ...task.files
  }
  let value = 'Old draft',
    inspectCount = 0,
    observation,
    acted = false
  return {
    execute(name, args) {
      if (task.failTool === name)
        return 'Tool error: fixture target disappeared; no action was performed.'
      if (task.uncertainTool === name)
        return 'Unverified: the requested change could not be confirmed. Inspect before continuing.'
      if (task.toolResults && Object.hasOwn(task.toolResults, name)) return task.toolResults[name]
      switch (name) {
        case 'list_windows':
          return untrustedData('window-list', 'windows', WINDOWS)
        case 'open_app':
          return ['notepad', 'paint', 'calculator', 'calc', 'mspaint'].includes(
            args.name.toLowerCase()
          )
            ? `Opened ${args.name}.`
            : 'Denied: only Calculator, Notepad and Paint can be launched.'
        case 'move_window':
          return `Moved "${args.title}". Verified window state.`
        case 'focus_window':
          return `Focused "${args.title ?? 'Draft - Notepad'}".`
        case 'close_window':
          return task.closeReported
            ? 'Asked "Draft - Notepad" to close; a save dialog remains.'
            : `Closed "${args.title ?? 'Draft - Notepad'}". Verified window closed.`
        case 'close_app':
          return 'Asked 1 window of notepad to close. A save dialog may remain; closure is unverified.'
        case 'inspect_app':
          observation = OBSERVATION.replace(/.$/, String(++inspectCount % 10))
          return untrustedData(
            'app-controls',
            'Draft - Notepad',
            JSON.stringify({
              observation,
              window: 'win-editor',
              controls: [
                {
                  control: 'c1',
                  enabled: true,
                  name: 'Draft message',
                  role: 'Edit',
                  value,
                  actions: ['set_value']
                },
                {
                  control: 'c2',
                  enabled: true,
                  name: 'Apply',
                  role: 'Button',
                  actions: ['invoke']
                },
                {
                  control: 'c3',
                  enabled: true,
                  name: 'Status',
                  role: 'Text',
                  value: acted ? 'Applied' : 'Ready',
                  actions: []
                }
              ]
            })
          )
        case 'act_on_control':
          if (args.observation !== observation || !['c1', 'c2'].includes(args.control))
            return 'Tool error: stale or unknown control; inspect_app again.'
          observation = undefined
          if (args.control === 'c1' && args.action === 'set_value') {
            value = args.text
            return 'Verified control action: set_value.'
          }
          if (args.control === 'c2' && args.action === 'invoke') {
            acted = true
            return 'Reported control action: invoke.'
          }
          return 'Tool error: action is not supported by this control.'
        case 'list_files':
          return untrustedData('file-list', '.', Object.keys(files).join('\n'))
        case 'read_file':
          return Object.hasOwn(files, args.path)
            ? untrustedData('local-file', args.path, files[args.path])
            : 'Tool error: file not found.'
        case 'write_file':
          if (Object.hasOwn(files, args.path) || args.overwrite)
            return 'Denied: overwrites are unavailable.'
          if (!/^[\w-]+\.(txt|md|csv)$/.test(args.path))
            return 'Denied: only new text documents in the working folder are supported.'
          files[args.path] = args.content
          return `Saved ${args.path} (${Buffer.byteLength(args.content)} bytes). Verified by reading back identical bytes.`
        case 'web_search': {
          const run = currentRun()
          if (++run.searches > 3) throw new Error('Search is limited to three calls per request.')
          const sources = (task.sources ?? SOURCES).slice(0, 5).map((source, index) => ({
            id: 'd1111111-1111-4111-a111-11111111111' + index,
            taskId: run.id,
            title: source.title,
            url: source.url,
            snippet: source.snippet ?? source.description,
            fetchedAt: '2026-10-23T12:00:00.000Z',
            provenance: 'untrusted-web'
          }))
          run.sources.push(...sources)
          return JSON.stringify(sources)
        }
        case 'look_at_screen':
          return {
            text: untrustedData(
              'screen-capture',
              'synthetic screen',
              'Synthetic fixture image, 720x180 pixels. No desktop was captured.'
            ),
            image: require('./image.cjs').screenshot(!!task.screen)
          }
        case 'type_text':
          return `Typed ${args.text.length} characters in "Draft - Notepad". Input accepted; effect unverified.`
        case 'press_keys':
          return `Pressed ${args.keys} in "Draft - Notepad".`
        case 'scroll':
          return `Scrolled ${args.direction} ${args.steps ?? 3} steps in "Draft - Notepad".`
        case 'click':
          return `Clicked ${args.button ?? 'left'} at ${args.x},${args.y}. Input accepted; effect unverified.`
        default:
          return 'Denied: fixture capability unavailable.'
      }
    }
  }
}
module.exports = { createFixtures, SOURCES }
