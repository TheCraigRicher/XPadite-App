const store = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(userId: string, maxPerMin = 20): boolean {
  const now = Date.now()
  let entry = store.get(userId)
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60_000 }
  }
  entry.count++
  store.set(userId, entry)
  return entry.count <= maxPerMin
}
