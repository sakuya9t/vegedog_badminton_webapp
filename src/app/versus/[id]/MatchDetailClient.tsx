'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatSessionDate } from '@/lib/dates'
import { gamesWon, matchWinner, teamPlayers, confirmProgress } from '@/lib/match'
import MemberPicker, { type PickedMember } from '@/components/MemberPicker'
import type { MatchWithDetails, MatchParticipantWithProfile } from '@/lib/types'

const MATCH_SELECT = `
  *,
  recorder:profiles!recorder_id(id, nickname, avatar_url),
  participants:match_participants(
    *, profile:profiles!user_id(id, nickname, avatar_url)
  ),
  games:match_games(*)
`

interface GameRow { t1: string; t2: string }

export default function MatchDetailClient({ initialMatch, currentUserId }: {
  initialMatch: MatchWithDetails
  currentUserId: string | null
}) {
  const router   = useRouter()
  const supabase = createClient()
  const [match, setMatch] = useState<MatchWithDetails>(initialMatch)
  const [busy, setBusy]   = useState<string | null>(null)
  const [error, setError] = useState('')
  const [replacing, setReplacing] = useState<string | null>(null)
  const [notifyEmail, setNotifyEmail] = useState(false)

  const isRecorder = match.recorder_id === currentUserId
  const editable   = isRecorder && (match.status === 'draft' || match.status === 'pending')

  const [rows, setRows] = useState<GameRow[]>(
    initialMatch.games.length
      ? [...initialMatch.games].sort((a, b) => a.game_no - b.game_no)
          .map(g => ({ t1: String(g.team1_score), t2: String(g.team2_score) }))
      : [{ t1: '', t2: '' }],
  )

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('matches').select(MATCH_SELECT).eq('id', match.id).single()
    if (data) setMatch(data as unknown as MatchWithDetails)
  }, [supabase, match.id])

  useEffect(() => {
    const channel = supabase
      .channel(`match-${match.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${match.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_participants', filter: `match_id=eq.${match.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_games', filter: `match_id=eq.${match.id}` }, refresh)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, match.id, refresh])

  const t1 = teamPlayers(match.participants, 1)
  const t2 = teamPlayers(match.participants, 2)
  const won = gamesWon(match.games)
  const winner = matchWinner(match.games)
  const { confirmed, total } = confirmProgress(match.participants)
  const myPendingConfirm = match.status === 'pending' && match.participants.some(
    p => p.user_id === currentUserId && !p.is_recorder && !p.is_guest && !p.confirmed,
  )

  async function rpc(fn: string, args: Record<string, unknown>, key: string) {
    setError(''); setBusy(key)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: e } = await (supabase.rpc as any)(fn, args)
    setBusy(null)
    if (e) { setError(e.message); return null }
    await refresh()
    return data
  }

  async function saveGames() {
    const games = rows
      .filter(r => r.t1 !== '' || r.t2 !== '')
      .map((r, i) => ({ game_no: i + 1, team1_score: parseInt(r.t1) || 0, team2_score: parseInt(r.t2) || 0 }))
    if (games.length === 0) { setError('请至少录入一局比分'); return }
    await rpc('set_match_games', { p_match_id: match.id, p_games: games }, 'save')
  }

  async function replaceParticipant(participantId: string, m: PickedMember | null) {
    if (!m) return
    setReplacing(null)
    await rpc('replace_match_participant', {
      p_participant_id: participantId,
      p_new_user_id:    m.user_id,
      p_guest_name:     m.is_guest ? m.display_name : null,
    }, 'replace')
  }

  async function sendConfirmRequest() {
    // Persist current scores first so confirmers see the latest result.
    await saveGames()
    const res = await rpc('request_match_confirmation', { p_match_id: match.id }, 'request')
    if (res === null) return
    // Only email the participants if the recorder opted in.
    if (notifyEmail) {
      fetch('/api/notify-match-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId: match.id }),
      }).catch(() => {})
    }
  }

  async function setPrivacy(next: boolean) {
    if (next === match.is_public) return
    if (match.status === 'pending' &&
        !confirm('更改公开性会重置所有人的确认，需要大家重新确认。确定继续？')) return
    await rpc('set_match_privacy', { p_match_id: match.id, p_is_public: next }, 'privacy')
  }

  async function cancel() {
    if (!confirm('确定取消这场对局？此操作不可撤销。')) return
    const r = await rpc('cancel_match', { p_match_id: match.id }, 'cancel')
    if (r !== null) router.push('/versus')
  }

  function PlayerLine({ p }: { p: MatchParticipantWithProfile }) {
    return (
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={p.profile?.avatar_url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${p.user_id ?? p.display_name}`}
          alt="" className="w-7 h-7 rounded-full bg-gray-100 shrink-0 object-cover" />
        <span className="text-sm text-gray-800 flex-1 truncate">
          {p.user_id
            ? <Link href={`/players/${p.user_id}`} className="hover:underline">{p.display_name}</Link>
            : p.display_name}
          {p.user_id === currentUserId && <span className="text-xs text-gray-400 ml-1">(你)</span>}
          {p.is_guest && <span className="ml-1.5 text-xs text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">访客</span>}
        </span>
        {!p.is_recorder && !p.is_guest && (
          match.status === 'published'
            ? <span className="text-xs text-green-600">✓ 已确认</span>
            : p.confirmed
              ? <span className="text-xs text-green-600">✓ 已确认</span>
              : match.status === 'pending'
                ? <span className="text-xs text-amber-500">待确认</span>
                : null
        )}
        {editable && !p.is_recorder && (
          <button type="button" onClick={() => setReplacing(p.id)}
            className="text-xs text-brand-600 hover:text-brand-700 px-1.5 py-0.5">改</button>
        )}
      </div>
    )
  }

  function Team({ players, score, win, label }: {
    players: MatchParticipantWithProfile[]; score: number; win: boolean; label: string
  }) {
    return (
      <div className={`rounded-xl p-3 space-y-2 ${win ? 'bg-green-50' : 'bg-gray-50'}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-400">{label}</span>
          <span className={`text-lg font-bold tabular-nums ${win ? 'text-green-700' : 'text-gray-500'}`}>
            {score}
          </span>
        </div>
        {players.map(p => <PlayerLine key={p.id} p={p} />)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-brand-700 bg-brand-50 rounded px-1.5 py-0.5">
          {match.type === 'singles' ? '单打' : '双打'}
        </span>
        {!match.is_public && <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">不公开</span>}
        <span className="text-xs text-gray-400">{formatSessionDate(match.played_at)}</span>
        <span className="ml-auto text-xs font-medium text-gray-500">
          {match.status === 'draft' && '草稿'}
          {match.status === 'pending' && `待确认 ${confirmed}/${total}`}
          {match.status === 'published' && '已发布'}
        </span>
      </div>

      {/* Teams */}
      <div className="space-y-2">
        <Team players={t1} score={won.team1} win={winner === 1} label="队伍 1（录入者一方）" />
        <Team players={t2} score={won.team2} win={winner === 2} label="队伍 2" />
      </div>

      {/* Score entry (recorder, editable) */}
      {editable ? (
        <div className="card space-y-3">
          <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">录入比分</h2>
          <div className="grid grid-cols-[2.5rem_1fr_1fr_2rem] gap-2 items-center text-xs text-gray-400">
            <span></span><span className="text-center">队伍 1</span><span className="text-center">队伍 2</span><span></span>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[2.5rem_1fr_1fr_2rem] gap-2 items-center">
              <span className="text-sm text-gray-500">局{i + 1}</span>
              <input type="number" inputMode="numeric" min="0" className="input text-center" value={r.t1}
                onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, t1: e.target.value } : x))} />
              <input type="number" inputMode="numeric" min="0" className="input text-center" value={r.t2}
                onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, t2: e.target.value } : x))} />
              <button type="button"
                onClick={() => setRows(rs => rs.length > 1 ? rs.filter((_, j) => j !== i) : rs)}
                className="text-gray-300 hover:text-red-500 text-lg">×</button>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setRows(rs => [...rs, { t1: '', t2: '' }])}
              className="text-sm font-medium text-brand-600">+ 加一局</button>
            <button type="button" disabled={busy === 'save'} onClick={saveGames}
              className="ml-auto text-sm font-semibold text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg
                         active:bg-gray-50 disabled:opacity-50">
              {busy === 'save' ? '保存中…' : '保存比分'}
            </button>
          </div>
          {match.status === 'pending' && (
            <p className="text-xs text-amber-600">注意：在待确认状态下修改比分会重置所有人的确认。</p>
          )}
        </div>
      ) : (
        match.games.length > 0 && (
          <div className="card space-y-1.5">
            <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">各局比分</h2>
            {[...match.games].sort((a, b) => a.game_no - b.game_no).map(g => (
              <div key={g.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-400">局{g.game_no}</span>
                <span className="tabular-nums text-gray-700">{g.team1_score} : {g.team2_score}</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* Visibility (recorder, editable). Locked once published. */}
      {editable && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">公开性</h2>
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {([true, false] as const).map(v => (
              <button key={String(v)} type="button" disabled={busy === 'privacy'}
                onClick={() => setPrivacy(v)}
                className={`flex-1 text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50
                  ${match.is_public === v ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500'}`}>
                {v ? '公开' : '不公开'}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">
            {match.is_public ? '所有登录用户都能在对战历史看到。' : '仅参与方可在对战历史看到。'}
            无论是否公开，本场对局都会计入菜狗杯 ELO 积分。
          </p>
          {match.status === 'pending' && (
            <p className="text-xs text-amber-600">注意：更改公开性会重置所有人的确认。</p>
          )}
        </div>
      )}

      {/* Visibility (locked once published). */}
      {match.status === 'published' && (
        <p className="text-xs text-gray-400 text-center">
          {match.is_public ? '此对局已公开' : '此对局不公开'}，发布后公开性已锁定。
        </p>
      )}

      {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>}

      {/* Email opt-in — applies to (re)sending the confirmation request. */}
      {isRecorder && (match.status === 'draft' || match.status === 'pending') && (
        <label className="card flex items-center justify-between cursor-pointer select-none">
          <span>
            <span className="text-sm font-medium text-gray-700">发送邮件通知参与方</span>
            <span className="block text-xs text-gray-400 mt-0.5">
              默认不发送；勾选后向待确认的注册参与方发送邮件提醒。
            </span>
          </span>
          <input type="checkbox" checked={notifyEmail} onChange={e => setNotifyEmail(e.target.checked)}
            className="w-4 h-4 rounded accent-brand-600 shrink-0" />
        </label>
      )}

      {/* Actions */}
      {isRecorder && match.status === 'draft' && (
        <div className="flex gap-2">
          <button type="button" onClick={cancel} disabled={busy === 'cancel'}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 active:bg-gray-50">
            取消对局
          </button>
          <button type="button" onClick={sendConfirmRequest} disabled={busy === 'request'}
            className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold active:bg-brand-700 disabled:opacity-50">
            {busy === 'request' ? '发送中…' : '发送确认请求'}
          </button>
        </div>
      )}

      {isRecorder && match.status === 'pending' && (
        <div className="space-y-2">
          <p className="text-sm text-amber-700 bg-amber-50 rounded-xl px-4 py-3">
            等待对方确认（{confirmed}/{total}）。全部确认后将自动发布。
          </p>
          <button type="button" onClick={sendConfirmRequest} disabled={busy === 'request'}
            className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 active:bg-gray-50 disabled:opacity-50">
            {busy === 'request' ? '发送中…' : '重新发送确认请求'}
          </button>
        </div>
      )}

      {myPendingConfirm && (
        <button type="button" onClick={() => rpc('confirm_match', { p_match_id: match.id }, 'confirm')}
          disabled={busy === 'confirm'}
          className="w-full py-3 rounded-xl bg-green-600 text-white text-sm font-semibold active:bg-green-700 disabled:opacity-50">
          {busy === 'confirm' ? '确认中…' : '确认这场对局结果'}
        </button>
      )}

      {match.status === 'published' && (
        <p className="text-sm text-green-700 bg-green-50 rounded-xl px-4 py-3 text-center">
          ✓ 已全员确认并发布
        </p>
      )}

      {/* Replace-participant modal */}
      {replacing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setReplacing(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-3">
            <p className="text-base font-semibold text-gray-900">更换选手</p>
            <p className="text-xs text-gray-400">填错了？重新选择正确的会员（或访客）。</p>
            <MemberPicker label="新选手" value={null}
              onChange={m => replaceParticipant(replacing, m)}
              excludeIds={[match.recorder_id, ...match.participants
                .filter(p => p.id !== replacing && p.user_id)
                .map(p => p.user_id as string)]} />
            <button type="button" onClick={() => setReplacing(null)}
              className="w-full py-2 text-sm text-gray-400">取消</button>
          </div>
        </div>
      )}
    </div>
  )
}
