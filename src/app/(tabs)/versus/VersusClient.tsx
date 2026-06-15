'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatSessionDate } from '@/lib/dates'
import {
  gamesWon, matchWinner, scoreLine, teamPlayers, confirmProgress,
} from '@/lib/match'
import type { MatchWithDetails, MatchParticipantWithProfile } from '@/lib/types'

const MATCH_SELECT = `
  *,
  recorder:profiles!recorder_id(id, nickname, avatar_url),
  participants:match_participants(
    *, profile:profiles!user_id(id, nickname, avatar_url)
  ),
  games:match_games(*)
`

type SubTab = 'matches' | 'history' | 'cup'

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

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  draft:     { label: '草稿',   cls: 'text-gray-500 bg-gray-100' },
  pending:   { label: '待确认', cls: 'text-amber-700 bg-amber-50' },
  published: { label: '已发布', cls: 'text-green-700 bg-green-50' },
}

function MatchCard({ match, currentUserId, onConfirm, busy }: {
  match: MatchWithDetails
  currentUserId: string | null
  onConfirm?: (id: string) => void
  busy?: boolean
}) {
  const router = useRouter()
  const winner = matchWinner(match.games)
  const won = gamesWon(match.games)
  const t1 = teamPlayers(match.participants, 1)
  const t2 = teamPlayers(match.participants, 2)
  const { confirmed, total } = confirmProgress(match.participants)
  const chip = STATUS_CHIP[match.status]

  const myPending = match.status === 'pending' && match.participants.some(
    p => p.user_id === currentUserId && !p.is_recorder && !p.is_guest && !p.confirmed,
  )

  return (
    <div role="button" tabIndex={0}
      onClick={() => router.push(`/versus/${match.id}`)}
      onKeyDown={e => { if (e.key === 'Enter') router.push(`/versus/${match.id}`) }}
      className="card space-y-2 cursor-pointer transition-colors hover:bg-gray-50 active:bg-gray-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-brand-700 bg-brand-50 rounded px-1.5 py-0.5">
            {match.type === 'singles' ? '单打' : '双打'}
          </span>
          {!match.is_public && (
            <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">不公开</span>
          )}
          <span className="text-xs text-gray-400">{formatSessionDate(match.played_at)}</span>
        </div>
        {chip && (
          <span className={`text-xs font-medium rounded px-1.5 py-0.5 ${chip.cls}`}>
            {match.status === 'pending' ? `${chip.label} ${confirmed}/${total}` : chip.label}
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

      <div className="flex items-center gap-2 pt-1">
        <span className="text-xs text-gray-300">查看详情 ›</span>
        {myPending && onConfirm && (
          <button type="button" disabled={busy}
            onClick={e => { e.stopPropagation(); onConfirm(match.id) }}
            className="ml-auto text-xs font-semibold text-white bg-green-600 px-3 py-1.5 rounded-lg
                       active:bg-green-700 disabled:opacity-50 transition-colors">
            {busy ? '确认中…' : '确认对局'}
          </button>
        )}
      </div>
    </div>
  )
}

export default function VersusClient({ currentUserId, initialMatches }: {
  currentUserId: string | null
  initialMatches: MatchWithDetails[]
}) {
  const supabase = createClient()
  const [tab, setTab] = useState<SubTab>('matches')
  const [matches, setMatches] = useState<MatchWithDetails[]>(initialMatches)
  const [confirming, setConfirming] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('matches')
      .select(MATCH_SELECT)
      .neq('status', 'canceled')
      .order('created_at', { ascending: false })
    if (data) setMatches(data as unknown as MatchWithDetails[])
  }, [supabase])

  useEffect(() => {
    const channel = supabase
      .channel('versus-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_participants' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_games' }, refresh)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, refresh])

  async function confirm(matchId: string) {
    setConfirming(matchId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('confirm_match', { p_match_id: matchId })
    setConfirming(null)
    if (error) { alert(error.message); return }
    refresh()
  }

  const iRecord = (m: MatchWithDetails) => m.recorder_id === currentUserId
  const iConfirmed = (m: MatchWithDetails) => m.participants.some(
    p => p.user_id === currentUserId && !p.is_recorder && !p.is_guest && p.confirmed,
  )

  // 对局 sub-tab groupings — only the things needing my attention or still mine to manage.
  const needMyConfirm = matches.filter(m =>
    m.status === 'pending' && m.participants.some(
      p => p.user_id === currentUserId && !p.is_recorder && !p.is_guest && !p.confirmed,
    ),
  )
  const myDrafts  = matches.filter(m => iRecord(m) && m.status === 'draft')
  const myPending = matches.filter(m => iRecord(m) && m.status === 'pending')

  // 对战历史: published matches I can see (RLS already filters private), PLUS pending
  // matches I've personally confirmed. Once I've vouched for a result it belongs in my
  // history regardless of whether the other participants have confirmed yet (full
  // confirmation only gates Phase-2 积分, not visibility).
  const history = matches.filter(m =>
    m.status === 'published' || (m.status === 'pending' && iConfirmed(m)),
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">对战</h1>
        {tab === 'matches' && (
          <Link href="/versus/new"
            className="text-sm font-semibold text-white bg-brand-600 px-3 py-1.5 rounded-lg
                       active:bg-brand-700 transition-colors">
            + 新对局
          </Link>
        )}
      </div>

      {/* Sub-tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {([['matches', '对局'], ['history', '对战历史'], ['cup', '菜狗杯']] as [SubTab, string][]).map(
          ([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 text-sm font-medium py-1.5 rounded-lg transition-colors
                ${tab === key ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500'}`}>
              {label}
            </button>
          ),
        )}
      </div>

      {tab === 'matches' && (
        <div className="space-y-5">
          {needMyConfirm.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-amber-700">待你确认</h2>
              {needMyConfirm.map(m => (
                <MatchCard key={m.id} match={m} currentUserId={currentUserId}
                  onConfirm={confirm} busy={confirming === m.id} />
              ))}
            </section>
          )}

          {(myDrafts.length > 0 || myPending.length > 0) && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-500">我发起的</h2>
              {[...myDrafts, ...myPending].map(m => (
                <MatchCard key={m.id} match={m} currentUserId={currentUserId} />
              ))}
            </section>
          )}

          {needMyConfirm.length === 0 && myDrafts.length === 0 && myPending.length === 0 && (
            <div className="card text-center py-12 text-gray-400">
              <p className="text-3xl mb-2">🏸</p>
              <p className="text-sm">没有待处理的对局</p>
              <p className="text-xs mt-1">点「+ 新对局」记录一场，或在「对战历史」查看已确认的对局。</p>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-2">
          {history.length === 0 ? (
            <div className="card text-center py-12 text-gray-400">
              <p className="text-sm">暂无已发布的对战</p>
            </div>
          ) : (
            history.map(m => (
              <MatchCard key={m.id} match={m} currentUserId={currentUserId} />
            ))
          )}
        </div>
      )}

      {tab === 'cup' && (
        <div className="card text-gray-400 space-y-2">
          <p className="font-semibold text-gray-500 text-sm">菜狗杯 · 即将上线</p>
          <ul className="text-sm space-y-1.5">
            <li>📊 ELO 排名（低分易涨、高分难涨）</li>
            <li>🏆 积分追踪（仅全员确认的对局计分）</li>
            <li>🎯 tournament 分组助手</li>
          </ul>
        </div>
      )}
    </div>
  )
}
