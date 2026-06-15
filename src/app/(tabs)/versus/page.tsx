import { createClient } from '@/lib/supabase/server'
import VersusClient from './VersusClient'
import type { MatchWithDetails } from '@/lib/types'

export const revalidate = 0

export default async function VersusPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // RLS limits this to matches the user may see: their own, ones they're in,
  // and published public ones.
  const { data: matches } = await supabase
    .from('matches')
    .select(`
      *,
      recorder:profiles!recorder_id(id, nickname, avatar_url),
      participants:match_participants(
        *, profile:profiles!user_id(id, nickname, avatar_url)
      ),
      games:match_games(*)
    `)
    .neq('status', 'canceled')
    .order('created_at', { ascending: false })

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <VersusClient
        currentUserId={user?.id ?? null}
        initialMatches={(matches as unknown as MatchWithDetails[]) ?? []}
      />
    </main>
  )
}
