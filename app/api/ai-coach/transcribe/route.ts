import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/ai/client'
import { checkRateLimit } from '@/lib/ai/rate-limit'

const TRANSCRIBE_RATE_LIMIT = 10 // 10 per minute

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Authenticate
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Rate limit
  if (!checkRateLimit(`transcribe:${user.id}`, TRANSCRIBE_RATE_LIMIT)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // 3. Parse multipart form data
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const audioFile = formData.get('audio')
  if (!audioFile || !(audioFile instanceof Blob)) {
    return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
  }

  // 4. Size guard (5MB max)
  if (audioFile.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Audio file too large (max 5MB)' }, { status: 413 })
  }

  let openai: ReturnType<typeof getOpenAI>
  try {
    openai = getOpenAI()
  } catch {
    return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })
  }

  try {
    const file = new File([audioFile], 'audio.webm', { type: audioFile.type || 'audio/webm' })

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'text',
    })

    return NextResponse.json({ text: String(transcription).trim() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Transcription failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
