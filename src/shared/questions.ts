export interface ClarificationQuestion {
  title: string
  options: string[]
}
export function parseQuestions(value: string): ClarificationQuestion[] {
  const questions: unknown = JSON.parse(value)
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3)
    throw new Error('Ask one to three questions.')
  for (const question of questions) {
    if (
      !question ||
      typeof question !== 'object' ||
      Object.keys(question).some((key) => !['title', 'options'].includes(key)) ||
      typeof question.title !== 'string' ||
      !question.title.trim() ||
      question.title.length > 200 ||
      !Array.isArray(question.options) ||
      question.options.length < 2 ||
      question.options.length > 4 ||
      question.options.some(
        (option: unknown) => typeof option !== 'string' || !option.trim() || option.length > 100
      ) ||
      new Set(question.options).size !== question.options.length
    )
      throw new Error('Each question needs a title and two to four distinct short choices.')
  }
  return questions as ClarificationQuestion[]
}

export function questionsFromReply(text: string): ClarificationQuestion[] | undefined {
  const block = /^```sophon-questions\s*\n([\s\S]*?)\n```\s*$/.exec(text.trim())
  if (!block) return undefined
  try {
    return parseQuestions(block[1])
  } catch {
    return undefined
  }
}
