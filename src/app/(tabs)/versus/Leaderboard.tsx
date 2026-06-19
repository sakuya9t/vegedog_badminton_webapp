'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { PlayerRatingWithProfile } from '@/lib/types'

type Row = PlayerRatingWithProfile & { recentDelta: number | null }

const MEDAL = ['🥇', '🥈', '🥉']

function avatarFor(url: string | null | undefined, seed: string) {
  return url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${seed}`
}

/** Serpentine split: strongest snakes across groups so they stay balanced. */
function snakeGroups<T>(players: T[], n: number): T[][] {
  const groups: T[][] = Array.from({ length: n }, () => [])
  players.forEach((p, i) => {
    const round = Math.floor(i / n)
    const pos = i % n
    groups[round % 2 === 0 ? pos : n - 1 - pos].push(p)
  })
  return groups
}

export default function Leaderboard({ currentUserId }: { currentUserId: string | null }) {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Row[]>([])
  const [groupCount, setGroupCount] = useState(0) // 0 = grouping off

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('player_ratings')
      .select('user_id, rating, games_played, peak_rating, updated_at, profile:profiles!user_id(id, nickname, avatar_url)')
      .order('rating', { ascending: false })
    const ratings = (data ?? []) as unknown as PlayerRatingWithProfile[]

    // Most recent rating change per player (for the trend arrow).
    const { data: hist } = await supabase
      .from('rating_history')
      .select('user_id, delta, created_at')
      .order('created_at', { ascending: false })
      .limit(400)
    const latest = new Map<string, number>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const h of (hist ?? []) as any[]) if (!latest.has(h.user_id)) latest.set(h.user_id, h.delta)

    setRows(ratings.map(r => ({ ...r, recentDelta: latest.get(r.user_id) ?? null })))
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  // Live-update when a match publishes and ratings move.
  useEffect(() => {
    const ch = supabase
      .channel('leaderboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_ratings' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [supabase, load])

  if (loading) return <div className="card animate-pulse h-48" />

  if (rows.length === 0) {
    return (
      <div className="card text-gray-400 space-y-2">
        <p className="font-semibold text-gray-500 text-sm">对战排行榜</p>
        <p className="text-sm">还没有积分。完成一场全员确认（发布）的对局后，参与的注册成员就会上榜。</p>
        <ul className="text-xs space-y-1 text-gray-400">
          <li>📊 ELO 排名：低分易涨、高分难涨</li>
          <li>🏆 仅全员确认的对局计分；不公开的对局同样计分</li>
        </ul>
      </div>
    )
  }

  const groups = groupCount > 0 ? snakeGroups(rows, groupCount) : null

  // When the board is long, cap its height and scroll it internally. The current
  // user's row then pins (position: sticky, top+bottom) to the near edge so their
  // rank stays in view: stuck to the bottom while they're below the fold, flowing
  // normally as you scroll onto them, then stuck to the top once you scroll past.
  const pinCurrentUser = rows.length > 8

  return (
    <div className="space-y-3">
      {/* Leaderboard */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">对战排行榜</h2>
          <span className="text-[11px] text-gray-400">仅计已发布对局</span>
        </div>
        <div className={`space-y-1 ${pinCurrentUser ? 'max-h-[22rem] overflow-y-auto -mx-1 px-1' : ''}`}>
          {rows.map((r, i) => {
            const me = r.user_id === currentUserId
            const d = r.recentDelta
            return (
              <Link
                key={r.user_id}
                href={`/players/${r.user_id}`}
                className={`flex items-center gap-3 rounded-xl px-2 py-2 transition-colors
                  ${me ? 'bg-brand-50' : 'hover:bg-gray-50'}
                  ${me && pinCurrentUser ? 'sticky top-0 bottom-0 z-10 shadow-md ring-1 ring-brand-200' : ''}`}>
                <span className="w-6 text-center text-sm font-semibold tabular-nums shrink-0">
                  {i < 3 ? MEDAL[i] : <span className="text-gray-400">{i + 1}</span>}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={avatarFor(r.profile?.avatar_url, r.user_id)} alt=""
                  className="w-8 h-8 rounded-full object-cover bg-gray-100 shrink-0" />
                <span className="text-sm text-gray-800 flex-1 truncate">
                  {r.profile?.nickname ?? '未命名'}
                  {me && <span className="text-xs text-brand-600 ml-1">(你)</span>}
                </span>
                <span className="text-[11px] text-gray-400 tabular-nums shrink-0">{r.games_played} 局</span>
                <span className="text-sm font-semibold text-gray-900 tabular-nums w-12 text-right shrink-0">
                  {Math.round(r.rating)}
                </span>
                <span className={`text-[11px] tabular-nums w-10 text-right shrink-0 ${
                  d == null ? 'text-gray-300' : d > 0 ? 'text-green-600' : d < 0 ? 'text-red-500' : 'text-gray-400'
                }`}>
                  {d == null ? '—' : `${d > 0 ? '▲' : d < 0 ? '▼' : ''}${Math.abs(Math.round(d))}`}
                </span>
              </Link>
            )
          })}
        </div>
        <p className="text-[11px] text-gray-400 mt-3">分数初始 1000，低分易涨、高分难涨。</p>
      </div>

      {/* Grouping helper */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">分组助手</h2>
          <div className="flex gap-1">
            {[0, 2, 3, 4].map(n => (
              <button key={n} onClick={() => setGroupCount(n)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors
                  ${groupCount === n ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                {n === 0 ? '关闭' : `${n} 组`}
              </button>
            ))}
          </div>
        </div>
        {groups ? (
          <div className="grid grid-cols-2 gap-2">
            {groups.map((grp, gi) => (
              <div key={gi} className="bg-gray-50 rounded-xl p-2.5 space-y-1.5">
                <p className="text-xs font-semibold text-gray-500">第 {gi + 1} 组</p>
                {grp.map(p => (
                  <div key={p.user_id} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-700 truncate">{p.profile?.nickname ?? '未命名'}</span>
                    <span className="text-xs text-gray-400 tabular-nums shrink-0">{Math.round(p.rating)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">按当前排名蛇形分组，方便平衡分组打球。选择组数查看。</p>
        )}
      </div>
    </div>
  )
}
