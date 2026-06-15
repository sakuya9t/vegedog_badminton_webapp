import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Navbar from '@/components/Navbar'
import MatchDetailClient from './MatchDetailClient'
import type { MatchWithDetails } from '@/lib/types'

export const revalidate = 0

export default async function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: match }, { data: { user } }] = await Promise.all([
    supabase
      .from('matches')
      .select(`
        *,
        recorder:profiles!recorder_id(id, nickname, avatar_url),
        participants:match_participants(
          *, profile:profiles!user_id(id, nickname, avatar_url)
        ),
        games:match_games(*)
      `)
      .eq('id', id)
      .single(),
    supabase.auth.getUser(),
  ])

  if (!match) notFound()

  return (
    <>
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-6">
        <MatchDetailClient
          initialMatch={match as unknown as MatchWithDetails}
          currentUserId={user?.id ?? null}
        />
      </main>
    </>
  )
}
