import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI, AI_CHAT_MODEL, MAX_CONTEXT_MESSAGES, MAX_USER_MESSAGE_LEN } from '@/lib/ai/client'
import { buildCoachSystemPrompt } from '@/lib/ai/prompts'
import { ChatRequestSchema } from '@/lib/ai/schemas'
import { checkRateLimit } from '@/lib/ai/rate-limit'

export async function POST(req: NextRequest): Promise<NextResponse | Response> {
  // 1. Authenticate
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Rate limit (20 requests per user per minute)
  if (!checkRateLimit(user.id)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Please wait a moment.' }, { status: 429 })
  }

  // 3. Validate request size (rough guard before parsing JSON)
  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10)
  if (contentLength > 64_000) {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  }

  // 4. Parse and validate body
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = ChatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
  }

  const { messages, context } = parsed.data

  // 5. Sanitize: trim messages, enforce max length, take last N
  const apiMessages = messages
    .slice(-MAX_CONTEXT_MESSAGES)
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content.slice(0, MAX_USER_MESSAGE_LEN),
    }))

  // 6. Build system prompt with safe server-side context
  const systemPrompt = buildCoachSystemPrompt({
    today: context.today,
    timezone: context.timezone,
    activities: context.activities,
  })

  // 7. Call OpenAI with streaming
  let openai: ReturnType<typeof getOpenAI>
  try {
    openai = getOpenAI()
  } catch {
    return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })
  }

  try {
    const stream = await openai.chat.completions.create({
      model: AI_CHAT_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, ...apiMessages],
      stream: true,
      max_tokens: 600,
      temperature: 0.7,
    })

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content ?? ''
            if (text) controller.enqueue(encoder.encode(text))
          }
        } finally {
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI request failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
