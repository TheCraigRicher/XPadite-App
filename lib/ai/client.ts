import OpenAI from 'openai'

export function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')
  return new OpenAI({ apiKey })
}

export const AI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini'
export const AI_PLAN_MODEL = process.env.OPENAI_PLAN_MODEL ?? 'gpt-4o-mini'

export const MAX_CONTEXT_MESSAGES = 24
export const MAX_USER_MESSAGE_LEN = 2000
export const MAX_REQUEST_MESSAGES = 30
