export type ToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}
export type ContentPart =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'image_url'
      image_url: {
        url: string
      }
    }
export type ModelMessage = {
  contextGroup?: 'history' | 'memories' | 'request'
  responseState?: { model: string; scope?: string; reasoning: Record<string, unknown>[] }
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[]
  tool_calls?: ToolCall[]
  tool_call_id?: string
}
export type ChatHistory = ModelMessage[][]
export type ModelReply = {
  usage?: TokenUsage
  responseState?: ModelMessage['responseState']
  finishReason?: string
  content?: string | null
  tool_calls?: ToolCall[]
}
export type ChatEvent =
  | { type: 'model_progress'; progress?: ModelProgress }
  | { type: 'tool_output'; id: string; output: string }
  | { type: 'text'; text: string }
  | { type: 'quality'; status: 'checking' | 'reviewed' }
  | { type: 'specialist'; run: SpecialistRun }
  | {
      type: 'compaction'
      status: 'running' | 'done' | 'skipped'
      scope: ContextCompactionNotice['scope']
      info?: ContextCompaction
    }
  | { type: 'workflow'; state: WorkflowState }
  | { type: 'context'; report: ContextReport }
  | { type: 'tool_preview'; id: string; preview: string }
  | {
      type: 'tool_start'
      id: string
      name: string
      args: unknown
    }
  | {
      type: 'tool_wait'
      id: string
      canAlwaysAllow?: boolean
    }
  | {
      type: 'tool_resume'
      id: string
    }
  | {
      type: 'tool_end'
      id: string
      result: string
      outcome?: Exclude<EvidenceStatus, 'pending'>
      image?: string
    }
