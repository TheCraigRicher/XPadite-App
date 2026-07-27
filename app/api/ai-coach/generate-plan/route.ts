import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI, AI_PLAN_MODEL, MAX_CONTEXT_MESSAGES } from '@/lib/ai/client'
import { buildPlanSystemPrompt } from '@/lib/ai/prompts'
import { PlanRequestSchema, DraftPlanResponseSchema } from '@/lib/ai/schemas'
import { checkRateLimit } from '@/lib/ai/rate-limit'

const PLAN_RATE_LIMIT = 8 // plan generation is heavier — 8 per minute

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Authenticate
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Rate limit (separate tighter limit for plan generation)
  if (!checkRateLimit(`plan:${user.id}`, PLAN_RATE_LIMIT)) {
    return NextResponse.json({ error: 'Plan generation rate limit exceeded. Please wait.' }, { status: 429 })
  }

  // 3. Request size guard
  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10)
  if (contentLength > 64_000) {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  }

  // 4. Parse and validate
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = PlanRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { messages, context } = parsed.data

  const apiMessages = messages
    .slice(-MAX_CONTEXT_MESSAGES)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 2000) }))

  const systemPrompt = buildPlanSystemPrompt({
    today: context.today,
    timezone: context.timezone,
    activities: context.activities,
  })

  let openai: ReturnType<typeof getOpenAI>
  try {
    openai = getOpenAI()
  } catch {
    return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })
  }

  try {
    const completion = await openai.chat.completions.create({
      model: AI_PLAN_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, ...apiMessages],
      response_format: { type: 'json_object' },
      max_tokens: 4000,
      temperature: 0.3,
    })

    const raw = completion.choices[0]?.message?.content ?? ''

    let planJson: unknown
    try {
      planJson = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'AI returned invalid JSON', raw: raw.slice(0, 200) }, { status: 502 })
    }

    // Validate schema
    const validated = DraftPlanResponseSchema.safeParse(planJson)
    if (!validated.success) {
      console.error('[generate-plan] Schema validation failed:', validated.error.issues.slice(0, 5))
      return NextResponse.json(
        { error: 'Plan validation failed', issues: validated.error.issues.slice(0, 5) },
        { status: 502 }
      )
    }

    return NextResponse.json({ plan: validated.data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Plan generation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
