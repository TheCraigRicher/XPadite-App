import { redirect } from 'next/navigation'
import { parsePlan, planQuery } from '@/lib/billing/intent'

// "/" has no content of its own — the XPadite App lives at /app.
// Visitors are sent there; proxy.ts then routes signed-out visitors on to /login (keeping a valid ?plan=
// chosen on the Website) and leaves signed-in users on the App, exactly like a direct visit to /app.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { plan } = await searchParams
  redirect(`/app${planQuery(parsePlan(Array.isArray(plan) ? plan[0] : plan))}`)
}
