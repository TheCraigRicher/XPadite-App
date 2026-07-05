import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/app'

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Write full_name to profiles on every successful auth exchange.
      // This covers email-signup confirmation AND Google OAuth sign-in.
      // After exchangeCodeForSession the client has the session in memory,
      // so the authenticated UPDATE respects RLS (auth.uid() = id).
      const user = data.user
      if (user) {
        const fullName =
          (user.user_metadata?.full_name as string | null | undefined) ||
          (user.user_metadata?.name as string | null | undefined) ||
          null

        if (fullName?.trim()) {
          // Only set if the column is still null — never overwrite an existing name.
          await supabase
            .from('profiles')
            .update({ full_name: fullName.trim() })
            .eq('id', user.id)
            .is('full_name', null)
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=Could+not+verify+email`)
}
