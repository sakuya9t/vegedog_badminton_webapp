import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import SessionsClient from './SessionsClient'
import type { SessionWithInitiator } from '@/lib/types'

export const revalidate = 0

async function getSessions() {
  const supabase = await createClient()

  // Active (进行中) and history (已结束) in parallel.
  const [{ data: activeRows }, { data: historyRows }] = await Promise.all([
    supabase
      .from('sessions')
      .select(`*, initiator:profiles!initiator_id(id, nickname, avatar_url)`)
      .neq('status', 'canceled')
      .neq('status', 'closed')
      .order('starts_at', { ascending: true }),
    supabase
      .from('sessions')
      .select(`*, initiator:profiles!initiator_id(id, nickname, avatar_url)`)
      .eq('status', 'closed')
      .order('starts_at', { ascending: false })
      .limit(30),
  ])

  const active  = (activeRows  ?? []) as unknown as SessionWithInitiator[]
  const history = (historyRows ?? []) as unknown as SessionWithInitiator[]

  const ids = [...active, ...history].map(s => s.id)
  const { data: counts } = ids.length
    ? await supabase
        .from('participants')
        .select('session_id')
        .in('session_id', ids)
        .eq('status', 'joined')
    : { data: [] as { session_id: string }[] }

  const joinedBySession: Record<string, number> = {}
  for (const row of (counts ?? []) as { session_id: string }[]) {
    joinedBySession[row.session_id] = (joinedBySession[row.session_id] ?? 0) + 1
  }

  return { active, history, joinedBySession }
}

export default async function SessionsPage() {
  const { active, history, joinedBySession } = await getSessions()

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">接龙</h1>
        <Link href="/sessions/new"
          className="text-sm font-semibold text-white bg-brand-600 px-3 py-1.5 rounded-lg
                     active:bg-brand-700 transition-colors">
          + 发起接龙
        </Link>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/dog_chase.png" alt="" aria-hidden="true"
        className="fixed bottom-20 right-2 w-80 h-80 object-contain pointer-events-none opacity-30 z-0" />

      <SessionsClient active={active} history={history} joinedBySession={joinedBySession} />
    </main>
  )
}
