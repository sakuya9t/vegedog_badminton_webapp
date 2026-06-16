import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import Navbar from '@/components/Navbar'
import { gamesWon, matchWinner, scoreLine, teamPlayers } from '@/lib/match'
import { formatSessionDate } from '@/lib/dates'
import type { MatchWithDetails, MatchParticipantWithProfile } from '@/lib/types'

export const revalidate = 0

const MATCH_SELECT = `
  *,
  recorder:profiles!recorder_id(id, nickname, avatar_url),
  participants:match_participants(
    *, profile:profiles!user_id(id, nickname, avatar_url)
  ),
  games:match_games(*)
`

function avatarFor(url: string | null | undefined, seed: string) {
  return url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${seed}`
}

function TeamRow({ players, score, winner }: {
  players: MatchParticipantWithProfile[]
  score: number
  winner: boolean
}) {
  return (
    <div className={`flex items-center justify-between gap-2 ${winner ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
      <span className="text-sm truncate">
        {players.map(p => p.display_name).join(' & ') || '—'}
      </span>
      <span className="text-sm tabular-nums shrink-0">{score}</span>
    </div>
  )
}

/** Read-only card for a published match shown on a player's profile. */
function PlayerMatchCard({ match, playerId }: { match: MatchWithDetails; playerId: string }) {
  const winner = matchWinner(match.games)
  const won = gamesWon(match.games)
  const t1 = teamPlayers(match.participants, 1)
  const t2 = teamPlayers(match.participants, 2)
  const mine = match.participants.find(p => p.user_id === playerId)
  const result = winner === 0 || !mine ? null : winner === mine.team ? 'win' : 'loss'

  return (
    <Link href={`/versus/${match.id}`}
      className="card block space-y-2 transition-colors hover:bg-gray-50 active:bg-gray-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-brand-700 bg-brand-50 rounded px-1.5 py-0.5">
            {match.type === 'singles' ? '单打' : '双打'}
          </span>
          <span className="text-xs text-gray-400">{formatSessionDate(match.played_at)}</span>
        </div>
        {result && (
          <span className={`text-xs font-medium rounded px-1.5 py-0.5 ${
            result === 'win' ? 'text-green-700 bg-green-50' : 'text-gray-500 bg-gray-100'
          }`}>
            {result === 'win' ? '胜' : '负'}
          </span>
        )}
      </div>

      <div className="space-y-1">
        <TeamRow players={t1} score={won.team1} winner={winner === 1} />
        <TeamRow players={t2} score={won.team2} winner={winner === 2} />
      </div>

      {match.games.length > 0 && (
        <p className="text-xs text-gray-400 tabular-nums">比分 {scoreLine(match.games)}</p>
      )}
    </Link>
  )
}

export default async function PlayerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: { user } }, { data: profile }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('profiles').select('id, nickname, avatar_url').eq('id', id).maybeSingle(),
  ])
  if (!profile) notFound()

  // The matches this player took part in. RLS already limits SELECT to matches
  // the viewer may see; we further pin to published + public so the profile only
  // ever exposes what the player chose to publish publicly.
  const { data: partRows } = await supabase
    .from('match_participants')
    .select('match_id')
    .eq('user_id', id)

  const matchIds = [...new Set((partRows ?? []).map(r => r.match_id))]
  let matches: MatchWithDetails[] = []
  if (matchIds.length > 0) {
    const { data } = await supabase
      .from('matches')
      .select(MATCH_SELECT)
      .in('id', matchIds)
      .eq('status', 'published')
      .eq('is_public', true)
      .order('published_at', { ascending: false })
    matches = (data as unknown as MatchWithDetails[]) ?? []
  }

  let wins = 0, losses = 0
  for (const m of matches) {
    const mine = m.participants.find(p => p.user_id === id)
    const w = matchWinner(m.games)
    if (!mine || w === 0) continue
    if (w === mine.team) wins++; else losses++
  }

  const isSelf = user?.id === profile.id

  return (
    <>
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarFor(profile.avatar_url, profile.id)}
            alt=""
            className="w-16 h-16 rounded-full object-cover bg-gray-100 shrink-0"
          />
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 truncate">
              {profile.nickname || '未命名'}
              {isSelf && <span className="text-sm font-normal text-gray-400 ml-1.5">(你)</span>}
            </h1>
            <p className="text-sm text-gray-400 tabular-nums">
              已公开 {matches.length} 场 · {wins} 胜 {losses} 负
            </p>
          </div>
        </div>

        {/* Ranking score — Phase 2 placeholder */}
        <div className="card flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-500">排位分数</p>
            <p className="text-xs text-gray-400 mt-0.5">菜狗杯 ELO 积分</p>
          </div>
          <span className="text-xs font-medium text-gray-400 bg-gray-100 rounded-full px-3 py-1">
            即将上线
          </span>
        </div>

        {/* Public published matches */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-500">公开对局</h2>
          {matches.length === 0 ? (
            <div className="card text-center py-12 text-gray-400">
              <p className="text-3xl mb-2">🏸</p>
              <p className="text-sm">暂无公开对局</p>
            </div>
          ) : (
            matches.map(m => <PlayerMatchCard key={m.id} match={m} playerId={id} />)
          )}
        </section>
      </main>
    </>
  )
}
