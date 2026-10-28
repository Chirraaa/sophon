import { TOOL_BATCH_LIMIT } from '../../shared/loop-limits'
import { toolSchemas, TOOL_ARGUMENT_MAX_CHARS } from '../tools/schemas'

export class InvalidToolJsonError extends Error {
  constructor() {
    super(
      'The model returned malformed tool arguments. No tools in this batch were executed. Try the request again with smaller tool calls.'
    )
    this.name = 'InvalidToolJsonError'
  }
}

export class InvalidToolArgumentsError extends Error {}

export const TOOL_JSON_REPAIR =
  'Your last tool batch contained invalid or unfinished JSON arguments. No tools in that batch were executed. Reissue the necessary calls using complete valid JSON, escaping quotes and newlines inside strings. Keep calls within argument limits. write_file writes a complete file in one call: it cannot append or assemble chunks. Replacements require overwrite: true; prefer edit_file for focused changes. If an artifact exceeds the tool limits, provide it in chat and explain the saving limit. Use the structured tool API and preserve the original task and permissions.'

type Schema = {
  type: string
  properties?: Record<string, Schema>
  required?: string[]
  enum?: string[]
  items?: Schema
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
  maxLength?: number
  pattern?: string
}
export function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
}
function validate(value: unknown, schema: Schema, path: string): void {
  if (schema.type === 'array') {
    if (
      !Array.isArray(value) ||
      value.length < (schema.minItems ?? 0) ||
      value.length > (schema.maxItems ?? 100) ||
      (schema.uniqueItems &&
        new Set(value.map((item) => JSON.stringify(item))).size !== value.length)
    )
      throw new Error(`Invalid array: ${path}`)
    if (!schema.items) throw new Error(`Missing item schema: ${path}`)
    value.forEach((item, index) => validate(item, schema.items!, `${path}[${index}]`))
    return
  }
  if (schema.type === 'object') {
    if (!plainObject(value)) throw new Error(`Invalid object: ${path}`)
    const props = schema.properties ?? {}
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(props, key)) throw new Error(`Unknown argument: ${path}.${key}`)
      validate(value[key], props[key], `${path}.${key}`)
    }
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) throw new Error(`Missing argument: ${path}.${key}`)
    }
    return
  }
  if (typeof value !== schema.type) throw new Error(`Invalid type: ${path}`)
  if (typeof value === 'string') {
    if (value.includes('\0')) throw new Error(`Argument contains NUL: ${path}`)
    const limit = schema.maxLength ?? (path.endsWith('.content') ? 65536 : 2000)
    if (value.length > limit)
      throw new Error(
        `Argument too long: ${path} (${value.length} characters; maximum ${limit}). Use smaller focused edits or separate modules.`
      )
  }
  if (schema.enum && !schema.enum.includes(value as string))
    throw new Error(`Invalid option: ${path}`)
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value))
    throw new Error(
      `Invalid format: ${path}. Use the exact lowercase document slug without a folder or .md extension.`
    )
  if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 100000))
    throw new Error(`Invalid number: ${path}`)
}
export function validateToolArguments(name: string, args: unknown): Record<string, unknown> {
  const schema = toolSchemas.find((s) => s.function.name === name)?.function.parameters
  if (!schema) throw new Error('Unknown tool.')
  validate(args, schema as Schema, name)
  const size = JSON.stringify(args).length
  if (size > TOOL_ARGUMENT_MAX_CHARS)
    throw new Error(
      `Tool arguments too long: ${name} (${size} serialized characters; maximum ${TOOL_ARGUMENT_MAX_CHARS}). Split the work into smaller tool calls.`
    )
  const object = args as Record<string, unknown>
  if (name === 'click' && object.readback_region !== undefined && object.capture_after !== true)
    throw new Error('readback_region requires capture_after: true.')
  if (name === 'browser_act') {
    if (
      !/^dom-[\da-f]{12}$/.test(String(object.observation)) ||
      !/^e\d{1,2}$/.test(String(object.element))
    )
      throw new Error('Use exact DOM references from browser_inspect.')
    if (['fill', 'select'].includes(String(object.action)) !== Object.hasOwn(object, 'text'))
      throw new Error('Text is required only for fill or select.')
  }
  if (name === 'run_command') {
    if (!String(object.command).trim()) throw new Error('Provide a project command.')
    if (
      object.timeout_seconds !== undefined &&
      (!Number.isInteger(object.timeout_seconds) ||
        Number(object.timeout_seconds) < 1 ||
        Number(object.timeout_seconds) > 600)
    )
      throw new Error('timeout_seconds must be an integer from 1 to 600.')
  }
  if (name === 'coding_resources') {
    for (const [key, limit] of [
      ['edit_chars', 65536],
      ['read_chars', 60000]
    ] as const)
      if (
        object[key] !== undefined &&
        (!Number.isInteger(object[key]) || Number(object[key]) < 1 || Number(object[key]) > limit)
      )
        throw new Error(`${key} must be an integer from 1 to ${limit}.`)
    if (
      (object.edit_chars !== undefined || object.read_chars !== undefined) &&
      (typeof object.reason !== 'string' || !object.reason.trim())
    )
      throw new Error('Supply a short reason when requesting coding resource adjustments.')
  }
  if (name === 'read_file') {
    for (const [key, max] of [
      ['start_line', 100000],
      ['line_count', 500],
      ['max_chars', 60000]
    ] as const)
      if (
        object[key] !== undefined &&
        (!Number.isInteger(object[key]) || Number(object[key]) < 1 || Number(object[key]) > max)
      )
        throw new Error(`${key} must be an integer from 1 to ${max}.`)
  }
  if (name === 'edit_file') {
    if (object.edits !== undefined) {
      if (object.old_text !== undefined || object.new_text !== undefined)
        throw new Error('Use edits OR old_text/new_text, not both.')
      if ((object.edits as { old_text: string }[]).some((edit) => !edit.old_text.length))
        throw new Error('Each patch needs nonempty old_text.')
    } else if (
      typeof object.old_text !== 'string' ||
      !object.old_text.length ||
      typeof object.new_text !== 'string'
    )
      throw new Error('Provide old_text and new_text, or an edits array.')
  }
  if (name === 'set_volume') {
    if (object.volume === undefined && object.muted === undefined)
      throw new Error('Supply volume and/or muted.')
    if (object.volume !== undefined && (Number(object.volume) < 0 || Number(object.volume) > 100))
      throw new Error('Volume must be between 0 and 100 percent.')
    if (object.target !== undefined && !String(object.target).trim())
      throw new Error('Audio target cannot be empty.')
  }
  if (name === 'harness_manage' && object.action !== 'list') {
    if (typeof object.category !== 'string' || typeof object.name !== 'string')
      throw new Error(
        'harness_manage requires category and name for this action. Discover documents with {"action":"list"}, then use the exact category and lowercase name without a folder or .md extension.'
      )
    if (object.action === 'propose' && typeof object.content !== 'string')
      throw new Error(
        'harness_manage propose requires Markdown content with heading, Source:, Applies to:, and Limits:.'
      )
  }
  if (name === 'wait' && (Number(object.seconds) < 0.001 || Number(object.seconds) > 60))
    throw new Error('Wait duration must be between 0.001 and 60 seconds.')
  for (const key of ['name', 'title', 'path', 'query', 'keys', 'text']) {
    if (key === 'text' && ['act_on_control', 'browser_act'].includes(name)) continue
    if (Object.hasOwn(object, key) && typeof object[key] === 'string' && !object[key].trim())
      throw new Error(`Empty argument: ${key}`)
  }
  if (name === 'inspect_app' && String(object.query ?? '').length > 120)
    throw new Error('Control query exceeds 120 characters.')
  if (
    name === 'inspect_app' &&
    object.offset !== undefined &&
    (!Number.isInteger(object.offset) || Number(object.offset) < 0 || Number(object.offset) > 1000)
  )
    throw new Error('Control offset must be an integer from 0 to 1000.')
  if (name === 'act_on_control') {
    if (
      !/^obs-[\da-f]{12}$/.test(String(object.observation)) ||
      !/^c\d{1,2}$/.test(String(object.control))
    )
      throw new Error('Invalid control reference. Inspect the app first.')
    if ((object.action === 'set_value') !== Object.hasOwn(object, 'text'))
      throw new Error('Text is required only for set_value.')
    if (
      typeof object.text === 'string' &&
      [...object.text].some((char) => char.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(char))
    )
      throw new Error('Control text contains unsupported control characters.')
  }
  if (name === 'web_search' && String(object.query).length > 500)
    throw new Error('Query exceeds 500 characters.')
  if (
    name === 'scroll' &&
    object.steps !== undefined &&
    (!Number.isInteger(object.steps) || Number(object.steps) < 1 || Number(object.steps) > 8)
  )
    throw new Error('Invalid scroll steps.')
  return structuredClone(object)
}
export function parseToolCalls(value: unknown): {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
  args: Record<string, unknown>
}[] {
  if (!Array.isArray(value) || value.length > TOOL_BATCH_LIMIT)
    throw new Error(`Invalid tool batch: at most ${TOOL_BATCH_LIMIT} calls per reply.`)
  const ids = new Set<string>()
  return value.map((call) => {
    if (
      !plainObject(call) ||
      call.type !== 'function' ||
      typeof call.id !== 'string' ||
      !/^[\w-]{1,128}$/.test(call.id) ||
      ids.has(call.id) ||
      !plainObject(call.function) ||
      typeof call.function.name !== 'string' ||
      typeof call.function.arguments !== 'string' ||
      Object.keys(call).some((k) => !['id', 'type', 'function'].includes(k)) ||
      Object.keys(call.function).some((k) => !['name', 'arguments'].includes(k))
    )
      throw new Error('Invalid tool-call envelope.')
    ids.add(call.id)
    if (call.function.arguments.length > TOOL_ARGUMENT_MAX_CHARS)
      throw new InvalidToolArgumentsError(
        `Tool arguments too long: ${call.function.name} (${call.function.arguments.length} serialized characters; maximum ${TOOL_ARGUMENT_MAX_CHARS}). Split the work into smaller tool calls.`
      )
    let decoded: unknown
    try {
      decoded = JSON.parse(call.function.arguments)
    } catch {
      throw new InvalidToolJsonError()
    }
    const name = call.function.name
    let args: Record<string, unknown>
    try {
      args = validateToolArguments(call.function.name, decoded)
    } catch (error) {
      if (toolSchemas.some((schema) => schema.function.name === name))
        throw new InvalidToolArgumentsError((error as Error).message)
      throw error
    }
    return {
      id: call.id,
      type: 'function',
      function: { name: call.function.name, arguments: call.function.arguments },
      args
    }
  })
}
