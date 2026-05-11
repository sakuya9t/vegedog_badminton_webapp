'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatSessionDate } from '@/lib/dates'
import type {
  SessionWithInitiator, Participant, ParticipantWithProfile,
  PaymentMethod, PaymentRecord, Profile, PaymentMethodType, SessionAdmin,
} from '@/lib/types'
import { presetAddress } from '@/lib/locations'
import { buildCourtEmail } from '@/lib/courtEmail'
import DateTimePicker from '@/components/DateTimePicker'

// ── Props ──────────────────────────────────────────────────────────────────
interface Props {
  session:             SessionWithInitiator
  initialParticipants: ParticipantWithProfile[]
  paymentMethods:      PaymentMethod[]
  paymentRecords:      PaymentRecord[]
  initialAdmins:       SessionAdmin[]
  currentUser:         { id: string; profile: Profile | null } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = { open:'正在接龙', locked:'已锁定', canceled:'已取消', closed:'已结束' }
const STATUS_CLASS: Record<string, string> = {
  open:    'bg-brand-100 text-brand-700',
  locked:  'bg-blue-100 text-blue-700',
  canceled:'bg-red-100 text-red-700',
  closed:  'bg-gray-100 text-gray-500',
}
const PAY_CLASS: Record<string, string> = {
  paid:   'bg-green-100 text-green-700',
  unpaid: 'bg-red-100 text-red-700',
  waived: 'bg-orange-100 text-orange-700',
}
const PAY_LABEL: Record<string, string> = { paid:'已付 ✓', unpaid:'未支付', waived:'已免' }

type ParticipantRename = {
  id: string; participant_id: string; session_id: string
  user_id: string; old_name: string; new_name: string; created_at: string
}

function toLocalInput(isoUtc: string) {
  const d = new Date(isoUtc)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy} title="复制地址"
      className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600
                 hover:bg-gray-100 transition-colors">
      {copied ? (
        <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      )}
    </button>
  )
}

function openVenmo(accountRef: string, amount?: number | null, appUsername?: string) {
  const username = accountRef.startsWith('@') ? accountRef.slice(1) : accountRef
  const note = appUsername ? `${appUsername}` : `菜狗 @${username}`
  const params = new URLSearchParams({ txn: 'pay', recipients: username, note })
  if (amount) params.set('amount', amount.toFixed(2))
  // URLSearchParams encodes spaces as +; Venmo expects %20
  const query = params.toString().replace(/\+/g, '%20')
  // Try app deep link first; fall back to web if app not installed
  window.location.href = `venmo://paycharge?${query}`
  setTimeout(() => {
    window.open(`https://venmo.com/${username}`, '_blank')
  }, 1500)
}

// ── Main component ─────────────────────────────────────────────────────────
export default function SessionDetailClient({
  session,
  initialParticipants,
  paymentMethods: initialMethods,
  paymentRecords,
  initialAdmins,
  currentUser,
}: Props) {
  const supabase = createClient()
  const router   = useRouter()

  const [participants,    setParticipants]    = useState(initialParticipants)
  const [paymentMethods,  setPaymentMethods]  = useState(initialMethods)
  const [payRecords,      setPayRecords]      = useState(paymentRecords)
  const [admins,          setAdmins]          = useState<SessionAdmin[]>(initialAdmins)
  const [renames,           setRenames]           = useState<ParticipantRename[]>([])
  const [historyCollapsed,  setHistoryCollapsed]  = useState(false)
  const [joinName,  setJoinName]  = useState('')
  const [joining,   setJoining]   = useState(false)
  const [locking,   setLocking]   = useState(false)
  const [maxParticipants, setMaxParticipants] = useState(session.max_participants)
  const [isEditing, setIsEditing] = useState(false)
  const [editFields, setEditFields] = useState({
    title:             session.title,
    location:          session.location,
    starts_at:         toLocalInput(session.starts_at),
    withdraw_deadline: toLocalInput(session.withdraw_deadline),
    court_count:       session.court_count,
    max_participants:  session.max_participants,
    notes:             session.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [toast,     setToast]     = useState<{ msg: string; ok: boolean } | null>(null)
  const [confirm,   setConfirm]   = useState<{
    title: string; message: React.ReactNode; onConfirm: () => void; danger?: boolean
  } | null>(null)

  function showConfirm(title: string, message: React.ReactNode, onConfirm: () => void, danger = true) {
    setConfirm({ title, message, onConfirm, danger })
  }

  const isAdmin = admins.some(a => a.user_id === currentUser?.id)

  // ── Realtime subscriptions ────────────────────────────────────────────
  const refreshParticipants = useCallback(async () => {
    const { data } = await supabase
      .from('participants')
      .select(`*, profile:profiles!user_id(id, nickname, avatar_url, venmo_username)`)
      .eq('session_id', session.id)
      .order('queue_position')
    if (data) setParticipants(data as ParticipantWithProfile[])
  }, [session.id, supabase])

  const refreshPayRecords = useCallback(async () => {
    const { data } = await supabase
      .from('payment_records')
      .select('*')
      .eq('session_id', session.id)
    if (data) setPayRecords(data as PaymentRecord[])
  }, [session.id, supabase])

  const refreshRenames = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('participant_renames') as any)
      .select('*')
      .eq('session_id', session.id)
      .order('created_at', { ascending: false })
    if (data) setRenames(data as ParticipantRename[])
  }, [session.id, supabase])

  useEffect(() => {
    refreshRenames()
    const channel = supabase
      .channel(`session-${session.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'participants',
        filter: `session_id=eq.${session.id}`,
      }, refreshParticipants)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'payment_records',
        filter: `session_id=eq.${session.id}`,
      }, refreshPayRecords)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'participant_renames',
        filter: `session_id=eq.${session.id}`,
      }, refreshRenames)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [session.id, supabase, refreshParticipants, refreshPayRecords, refreshRenames])

  // ── Default join name ────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return
    const base = currentUser.profile?.nickname ?? 'Player'
    const mine = participants.filter(p => p.user_id === currentUser.id && (p.status === 'joined' || p.status === 'waitlist'))
    setJoinName(mine.length === 0 ? base : `${base} +${mine.length} = `)
  }, [participants, currentUser])

  // ── Toast helper ──────────────────────────────────────────────────────
  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Save session edits ───────────────────────────────────────────────
  async function handleSaveEdit() {
    setSaving(true)
    const newMax = Number(editFields.max_participants)

    // Update capacity via RPC so participants are promoted/demoted atomically
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const capResult = await (supabase.rpc as any)('update_session_capacity', {
      p_session_id: session.id, p_max_participants: newMax,
    })

    // Update remaining fields directly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('sessions') as any)
      .update({
        title:             editFields.title.trim(),
        location:          editFields.location.trim(),
        starts_at:         new Date(editFields.starts_at).toISOString(),
        withdraw_deadline: new Date(editFields.withdraw_deadline).toISOString(),
        court_count:       Number(editFields.court_count),
        notes:             editFields.notes.trim() || null,
      })
      .eq('id', session.id)

    setSaving(false)
    if (capResult.error) { showToast(capResult.error.message, false); return }
    if (error) { showToast(error.message, false); return }
    setMaxParticipants(newMax)
    showToast('已保存 ✓', true)
    setIsEditing(false)
    await refreshParticipants()
    router.refresh()
  }

  // ── Join ──────────────────────────────────────────────────────────────
  async function handleJoin() {
    if (!currentUser) { router.push(`/login?next=/sessions/${session.id}`); return }
    const name = joinName.trim() || (currentUser.profile?.nickname ?? 'Player')
    setJoining(true)

    // Optimistic update — show entry immediately
    const tempId = `temp-${Date.now()}`
    const joinedNow = participants.filter(p => p.status === 'joined').length
    const tempP: ParticipantWithProfile = {
      id: tempId, session_id: session.id, user_id: currentUser.id,
      display_name: name, queue_position: participants.length + 1,
      status: joinedNow < maxParticipants ? 'joined' : 'waitlist',
      stayed_late: false, joined_at: new Date().toISOString(), withdrew_at: null,
      profile: { id: currentUser.id, nickname: currentUser.profile?.nickname ?? 'Player', avatar_url: currentUser.profile?.avatar_url ?? null, venmo_username: null },
    }
    setParticipants(prev => [...prev, tempP])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('join_session', {
      p_session_id: session.id, p_user_id: currentUser.id, p_display_name: name,
    })
    setJoining(false)
    if (error) {
      setParticipants(prev => prev.filter(p => p.id !== tempId)) // revert
      showToast(error.message, false)
    } else {
      showToast('已加入！🎉')
      refreshParticipants()
    }
  }

  // ── Withdraw confirm (with late-understaffed warning) ─────────────────
  function confirmWithdraw(participantId: string, isJoined: boolean) {
    const isPastDeadline = new Date() > new Date(session.withdraw_deadline)
    const willBeUnderstaffed = joined.length - 1 < maxParticipants && waitlist.length === 0
    const showLateWarning = isJoined && isPastDeadline && willBeUnderstaffed

    const message = showLateWarning ? (
      <span className="text-center block space-y-2">
        <span className="block text-orange-600 font-semibold">⚠️ 您正在截止时间后退出！</span>
        <span className="block">退出后人数将低于满员上限，若最终人数不足，您仍需分摊场地费用。请寻找后补人员接替您的位置。</span>
      </span>
    ) : (
      <span className="text-center block">确定要退出接龙吗？退出后需重新排队。<br/>若只需改名请点击&nbsp;<svg className="w-3.5 h-3.5 inline-block align-middle mb-0.5" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>&nbsp;按键</span>
    )

    showConfirm('退出接龙', message, () => handleWithdraw(participantId))
  }

  // ── Withdraw ──────────────────────────────────────────────────────────
  async function handleWithdraw(participantId: string) {
    if (!currentUser) return

    // Capture the first waitlisted user before withdrawal (may be promoted)
    const firstWaitlisted = participants
      .filter(p => p.status === 'waitlist')
      .sort((a, b) => a.queue_position - b.queue_position)[0] ?? null

    // Optimistic update — hide entry immediately
    setParticipants(prev => prev.map(p =>
      p.id === participantId ? { ...p, status: 'withdrawn' as const, withdrew_at: new Date().toISOString() } : p
    ))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('withdraw_participant', {
      p_participant_id: participantId, p_user_id: currentUser.id,
    })
    if (error) { showToast(error.message, false); refreshParticipants(); return }

    showToast('已退出')
    await refreshParticipants()

    if (firstWaitlisted) {
      fetch('/api/notify-promoted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, promotedUserId: firstWaitlisted.user_id }),
      }).catch(() => {})
    }
  }

  // ── Lock session ──────────────────────────────────────────────────────
  async function handleLock() {
    setLocking(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('sessions') as any)
      .update({ status: 'locked' })
      .eq('id', session.id)
    setLocking(false)
    if (error) { showToast(error.message, false); return }
    // Trigger on_session_locked has created payment records — pull them now
    // so payRecords state is fresh before any toggle attempts
    await refreshPayRecords()
    showToast('接龙已锁定 🔒')
    router.refresh()
  }

  // ── Move to history ───────────────────────────────────────────────────
  const [closing, setClosing] = useState(false)
  async function handleClose() {
    showConfirm('移动到历史', '接龙将进入只读状态，所有数据将保留但无法修改。确定继续？', doClose)
  }
  async function doClose() {
    setClosing(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('sessions') as any)
      .update({ status: 'closed' })
      .eq('id', session.id)
    setClosing(false)
    if (error) showToast(error.message, false)
    else router.push('/history')
  }

  // ── Send court email ─────────────────────────────────────────────────
  const [sending,      setSending]      = useState(false)
  const [emailPreview, setEmailPreview] = useState<{ subject: string; body: string } | null>(null)

  function handlePreviewCourtEmail() {
    setEmailPreview(buildCourtEmail(session, joined))
  }

  async function doSendCourtEmail() {
    setEmailPreview(null)
    setSending(true)
    const res = await fetch('/api/send-court-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id }),
    })
    setSending(false)
    const json = await res.json()
    if (!res.ok) showToast(json.error ?? '发送失败', false)
    else showToast(`✉️ 已发送 ${json.count} 人名单`)
  }

  // ── Toggle stayed late ────────────────────────────────────────────────
  async function handleToggleLate(p: Participant) {
    const newVal = !p.stayed_late
    const action = newVal ? '加时' : '取消加时'
    showConfirm(
      `确定${action}？`,
      `确定 ${p.display_name} 晚场加时吗？`,
      async () => {
        setParticipants(prev => prev.map(pt => pt.id === p.id ? { ...pt, stayed_late: newVal } : pt))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.from('participants') as any)
          .update({ stayed_late: newVal })
          .eq('id', p.id)
        if (error) { showToast(error.message, false); refreshParticipants() }
      }
    )
  }

  // ── Admin management ─────────────────────────────────────────────────────
  const [adminSearchOpen,   setAdminSearchOpen]   = useState(false)
  const [adminSearch,       setAdminSearch]       = useState('')
  const [adminCandidates,   setAdminCandidates]   = useState<Profile[]>([])
  const adminInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!adminSearch.trim()) { setAdminCandidates([]); return }
    const timer = setTimeout(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('profiles') as any)
        .select('id, nickname, avatar_url')
        .ilike('nickname', `%${adminSearch.trim()}%`)
        .limit(6)
      setAdminCandidates(
        (data ?? []).filter((p: Profile) => !admins.some(a => a.user_id === p.id))
      )
    }, 200)
    return () => clearTimeout(timer)
  }, [adminSearch, admins, supabase])

  async function handleAddAdmin(profile: Profile) {
    setAdminSearch(''); setAdminSearchOpen(false); setAdminCandidates([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('session_admins') as any)
      .insert({ session_id: session.id, user_id: profile.id })
      .select(`session_id, user_id, created_at, profile:profiles!user_id(id, nickname, avatar_url)`)
      .single()
    if (error) showToast(error.message, false)
    else setAdmins(prev => [...prev, data as SessionAdmin])
  }

  async function handleRemoveAdmin(userId: string) {
    showConfirm('移除管理员', '确定移除此管理员？移除后他们将失去管理权限。', () => doRemoveAdmin(userId))
  }
  async function doRemoveAdmin(userId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('session_admins') as any)
      .delete().eq('session_id', session.id).eq('user_id', userId)
    if (error) showToast(error.message, false)
    else setAdmins(prev => prev.filter(a => a.user_id !== userId))
  }

  useEffect(() => {
    if (adminSearchOpen) setTimeout(() => adminInputRef.current?.focus(), 50)
  }, [adminSearchOpen])

  // ── Rename own participant entry ──────────────────────────────────────────
  async function handleRename(participantId: string, newName: string) {
    if (!currentUser) return
    const p = participants.find(x => x.id === participantId)
    if (!p || newName.trim() === p.display_name) return
    setParticipants(prev => prev.map(x => x.id === participantId ? { ...x, display_name: newName.trim() } : x))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('rename_participant', {
      p_participant_id: participantId,
      p_new_name: newName.trim(),
    })
    if (error) { showToast(error.message, false); refreshParticipants(); return }
    showToast('已更新')
    refreshRenames()
  }

  // ── Self-service payment toggle ───────────────────────────────────────────
  async function handleTogglePayment(participantId: string) {
    if (!currentUser) return
    const existing = payRecords.find(r => r.participant_id === participantId)
    const newStatus: 'paid' | 'unpaid' = existing?.status === 'paid' ? 'unpaid' : 'paid'

    if (existing && !existing.id.startsWith('temp-')) {
      // Optimistic update then patch
      setPayRecords(prev => prev.map(r =>
        r.participant_id === participantId ? { ...r, status: newStatus } : r
      ))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('payment_records') as any)
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) {
        showToast(error.message, false)
        setPayRecords(prev => prev.map(r =>
          r.participant_id === participantId ? { ...r, status: existing.status } : r
        ))
      }
    } else if (!existing) {
      // Fallback: no record — insert with 'paid' and refresh to get real UUID
      const tempId = `temp-${Date.now()}`
      setPayRecords(prev => [...prev, {
        id: tempId, session_id: session.id, participant_id: participantId,
        status: 'paid', note: null,
        updated_at: new Date().toISOString(),
      }])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('payment_records') as any)
        .insert({ session_id: session.id, participant_id: participantId,
                  status: 'paid' })
      if (error) {
        showToast(error instanceof Error ? error.message : '出现错误', false)
        setPayRecords(prev => prev.filter(r => r.id !== tempId))
      } else {
        // Replace temp entry with the real DB row (gets a valid UUID)
        await refreshPayRecords()
      }
    }
  }

  // ── Participant search (admin, locked) ───────────────────────────────
  const [searchOpen,       setSearchOpen]       = useState(false)
  const [searchQuery,      setSearchQuery]      = useState('')
  const [matchIdx,         setMatchIdx]         = useState(0)
  const [dropdownVisible,  setDropdownVisible]  = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map())

  function closeSearch() {
    setSearchOpen(false); setSearchQuery(''); setMatchIdx(0); setDropdownVisible(false)
  }

  function fuzzyMatch(name: string, query: string): boolean {
    const n = name.toLowerCase(), q = query.toLowerCase()
    let qi = 0
    for (let i = 0; i < n.length && qi < q.length; i++) if (n[i] === q[qi]) qi++
    return qi === q.length
  }

  // ── Partition participants ────────────────────────────────────────────
  const joined    = participants.filter(p => p.status === 'joined')
  const waitlist  = participants.filter(p => p.status === 'waitlist')
  const withdrawn = participants.filter(p => p.status === 'withdrawn' || p.status === 'late_withdraw')
    .sort((a,b) => new Date(b.withdrew_at ?? 0).getTime() - new Date(a.withdrew_at ?? 0).getTime())

  const myActiveEntries = currentUser
    ? participants.filter(p => p.user_id === currentUser.id && (p.status === 'joined' || p.status === 'waitlist'))
    : []

  const searchMatches = searchQuery.trim()
    ? joined.filter(p =>
        fuzzyMatch(p.display_name, searchQuery) ||
        fuzzyMatch(p.profile?.nickname ?? '', searchQuery))
    : []
  const safeMatchIdx = searchMatches.length > 0 ? Math.min(matchIdx, searchMatches.length - 1) : 0
  const currentMatchId = searchMatches[safeMatchIdx]?.id ?? null

  // Auto-scroll to current match
  useEffect(() => {
    if (!currentMatchId) return
    rowRefs.current.get(currentMatchId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [currentMatchId])

  // Focus input when search opens
  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50)
  }, [searchOpen])

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Confirm dialog */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirm(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3">
            <h3 className="text-base font-bold text-gray-900 text-center">{confirm.title}</h3>
            <p className="text-sm text-gray-500 leading-relaxed text-center">{confirm.message}</p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setConfirm(null)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold
                           active:bg-gray-200 transition-colors">
                取消
              </button>
              <button
                onClick={() => { const fn = confirm.onConfirm; setConfirm(null); fn() }}
                className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold
                            active:opacity-80 transition-colors
                            ${confirm.danger !== false ? 'bg-red-500' : 'bg-brand-600'}`}>
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email preview dialog */}
      {emailPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEmailPreview(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[80vh]">
            <div className="px-5 pt-5 pb-3 border-b border-gray-100">
              <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-1">邮件预览</p>
              <p className="text-sm font-semibold text-gray-900">{emailPreview.subject}</p>
            </div>
            <pre className="px-5 py-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed overflow-y-auto flex-1 font-sans">
              {emailPreview.body}
            </pre>
            <div className="flex gap-2 px-5 pb-5 pt-3 border-t border-gray-100">
              <button onClick={() => setEmailPreview(null)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold
                           active:bg-gray-200 transition-colors">
                取消
              </button>
              <button onClick={doSendCourtEmail}
                className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold
                           active:opacity-80 transition-colors">
                确认发送
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl
                        text-white text-sm font-semibold shadow-lg transition-all
                        ${toast.ok ? 'bg-brand-600' : 'bg-red-500'}`}>
          {toast.msg}
        </div>
      )}

      {/* Meta card */}
      <div className="card space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-bold text-gray-900 leading-tight">
            {isEditing ? (
              <input className="input text-base font-bold" value={editFields.title}
                onChange={e => setEditFields(f => ({ ...f, title: e.target.value }))} />
            ) : session.title}
          </h1>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`badge ${STATUS_CLASS[session.status]}`}>
              {STATUS_LABEL[session.status]}
            </span>
            {!isEditing && <ShareButton sessionId={session.id} title={session.title} />}
            {isAdmin && session.status === 'open' && !isEditing && (
              <button onClick={() => setIsEditing(true)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400
                           hover:text-gray-600 hover:bg-gray-100 transition-colors" title="编辑">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="space-y-2 text-sm">
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">开始时间</label>
                <DateTimePicker label="开始时间" value={editFields.starts_at}
                  onChange={v => setEditFields(f => ({ ...f, starts_at: v }))} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">退出截止</label>
                <DateTimePicker label="退出截止时间" value={editFields.withdraw_deadline}
                  onChange={v => setEditFields(f => ({ ...f, withdraw_deadline: v }))} />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">地点</label>
              <input className="input" value={editFields.location}
                onChange={e => setEditFields(f => ({ ...f, location: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">场地数</label>
                <input type="number" min={1} className="input" value={editFields.court_count}
                  onChange={e => setEditFields(f => ({ ...f, court_count: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">人数上限</label>
                <input type="number" min={1} className="input" value={editFields.max_participants}
                  onChange={e => setEditFields(f => ({ ...f, max_participants: Number(e.target.value) }))} />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">注意事项</label>
              <textarea className="input resize-none" rows={2} value={editFields.notes}
                onChange={e => setEditFields(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleSaveEdit} disabled={saving}
                className="flex-1 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold
                           disabled:opacity-50 transition-colors">
                {saving ? '保存中…' : '保存'}
              </button>
              <button onClick={() => setIsEditing(false)}
                className="flex-1 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-semibold">
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5 text-sm text-gray-600">
            <div className="flex gap-2"><span>📅</span><span suppressHydrationWarning>{formatSessionDate(session.starts_at)}</span></div>
            <div className="flex gap-2"><span>⏰</span>
              <span suppressHydrationWarning>退出截止：{formatSessionDate(session.withdraw_deadline)}</span>
            </div>
            {/* Location with address + copy */}
            <div className="flex gap-2">
              <span>📍</span>
              <div className="flex-1 min-w-0">
                <span>{session.location}</span>
                {(() => {
                  const addr = (session as any).location_address ?? presetAddress(session.location)
                  return addr ? (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-400 flex-1 leading-relaxed">{addr}</span>
                      <CopyButton text={addr} />
                    </div>
                  ) : null
                })()}
              </div>
            </div>
            <div className="flex gap-2"><span>🏸</span>
              <span>{session.court_count}片场地 · {maxParticipants}人满员</span>
            </div>
          </div>
        )}

        {/* Admin controls */}
        {isAdmin && session.status === 'open' && !isEditing && (
          <button
            onClick={() => showConfirm('锁定接龙', `锁定之后接龙人员名单将无法改变！\n\n当前已报名 ${joined.length} 人，候补 ${waitlist.length} 人。确定锁定？`, handleLock, true)}
            disabled={locking}
            className="w-full mt-2 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold
                       active:bg-blue-700 disabled:opacity-50 transition-colors">
            {locking ? '锁定中…' : '🔒 锁定接龙'}
          </button>
        )}
        {isAdmin && session.status === 'locked' && (
          <div className="flex gap-2 mt-2">
            <button onClick={handlePreviewCourtEmail} disabled={sending}
              className="flex-1 py-2 rounded-xl bg-brand-50 text-brand-700 text-sm font-semibold
                         active:bg-brand-100 disabled:opacity-50 transition-colors">
              {sending ? '发送中…' : '✉️ 发给球馆'}
            </button>
            <button onClick={handleClose} disabled={closing}
              className="flex-1 py-2 rounded-xl bg-gray-200 text-gray-600 text-sm font-semibold
                         active:bg-gray-300 disabled:opacity-50 transition-colors">
              {closing ? '移动中…' : '📁 移动到历史'}
            </button>
          </div>
        )}

        {/* Admin management — visible to all logged-in users */}
        {currentUser && session.status !== 'closed' && admins.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">管理员</p>
            <div className="space-y-1.5">
              {admins.map(a => (
                <div key={a.user_id} className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={(a.profile as any)?.avatar_url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${a.user_id}`}
                    alt="" className="w-6 h-6 rounded-full bg-gray-100 shrink-0 object-cover" />
                  <span className="text-sm text-gray-700 flex-1">
                    {(a.profile as any)?.nickname ?? a.user_id}
                    {a.user_id === session.initiator_id && (
                      <span className="ml-1.5 text-xs text-gray-400">（发起人）</span>
                    )}
                  </span>
                  {/* Cannot remove the initiator; only admins see the remove button */}
                  {isAdmin && a.user_id !== session.initiator_id && (
                    <button onClick={() => handleRemoveAdmin(a.user_id)}
                      className="text-xs text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded transition-colors">
                      移除
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add admin — admin only */}
            {isAdmin && (!adminSearchOpen ? (
              <button onClick={() => setAdminSearchOpen(true)}
                className="text-xs text-brand-600 font-semibold">
                + 添加管理员
              </button>
            ) : (
              <div className="relative">
                <input
                  ref={adminInputRef}
                  value={adminSearch}
                  onChange={e => setAdminSearch(e.target.value)}
                  placeholder="搜索用户昵称…"
                  className="input text-sm"
                  onBlur={() => setTimeout(() => { setAdminSearchOpen(false); setAdminSearch(''); setAdminCandidates([]) }, 150)}
                />
                {adminCandidates.length > 0 && (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-gray-100
                                  rounded-xl shadow-lg overflow-hidden">
                    {adminCandidates.map(p => (
                      <button key={p.id} onMouseDown={() => handleAddAdmin(p)}
                        className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.avatar_url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${p.id}`}
                          alt="" className="w-6 h-6 rounded-full bg-gray-100 shrink-0 object-cover" />
                        <span>{p.nickname}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

      </div>

      {/* Notes card — below meta */}
      {session.notes && (
        <div className="card bg-pink-50 border border-pink-100">
          <p className="text-xs font-semibold text-pink-600 uppercase tracking-wide mb-2">注意事项</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{session.notes}</p>
        </div>
      )}

      {/* Join section */}
      {session.status === 'open' && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-gray-900">加入接龙</h2>
          {currentUser ? (
            <>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  报名名称（可改为 +1、+2 多次报名）
                </label>
                <input className="input" value={joinName} onChange={e => setJoinName(e.target.value)} />
              </div>
              <button onClick={handleJoin} disabled={joining} className="btn-primary">
                {joining ? '加入中…' : `以"${joinName}"加入`}
              </button>
              {myActiveEntries.length > 0 && (
                <p className="text-xs text-gray-400 text-center">
                  已有 {myActiveEntries.length} 个报名，点击「退出」可撤回。
                </p>
              )}
            </>
          ) : (
            <a href={`/login?next=/sessions/${session.id}`}
               className="btn-primary text-center block py-3 rounded-xl bg-brand-600 text-white font-semibold">
              登录后加入
            </a>
          )}
        </div>
      )}

      {session.status === 'locked' && (
        <div className="text-center text-sm text-gray-400 py-2">
          🔒 接龙已锁定，无法加入或撤回
        </div>
      )}

      {/* Participant list */}
      <div className="card space-y-2">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">
              已报名（{joined.length}/{maxParticipants}）
            </h2>
            {session.status === 'locked' && payRecords.some(r => joined.some(p => p.id === r.participant_id)) && (
              <p className="text-xs text-gray-400 mt-0.5">
                已付款（{payRecords.filter(r => r.status === 'paid' && joined.some(p => p.id === r.participant_id)).length}/{joined.length}）
              </p>
            )}
          </div>
          {/* Participant search — locked sessions, all logged-in users */}
          {currentUser && session.status === 'locked' && (
            <button
              onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors
                          ${searchOpen ? 'bg-brand-100 text-brand-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}>
              <span>查找</span>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
              </svg>
            </button>
          )}
        </div>

        {joined.length === 0 && waitlist.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">暂无报名，快来第一个！</p>
        ) : (
          <div className="space-y-1">
            {joined.map((p, i) => (
              <div key={p.id}
                ref={el => { if (el) rowRefs.current.set(p.id, el); else rowRefs.current.delete(p.id) }}
                className={`rounded-lg transition-colors duration-300
                            ${p.id === currentMatchId ? 'bg-yellow-50 ring-1 ring-yellow-300' : ''}`}>
                <ParticipantRow p={p} rank={i+1}
                  isAdmin={isAdmin}
                  isLocked={session.status === 'locked' || session.status === 'closed'}
                  allowActions={session.status === 'locked'}
                  isOwn={currentUser?.id === p.user_id}
                  canEdit={currentUser?.id === p.user_id && session.status !== 'closed' && session.status !== 'canceled'}
                  payRecord={payRecords.find(r => r.participant_id === p.id)}
                  onWithdraw={() => confirmWithdraw(p.id, true)}
                  onToggleLate={() => handleToggleLate(p)}
                  onTogglePayment={() => handleTogglePayment(p.id)}
                  onRename={n => handleRename(p.id, n)} />
              </div>
            ))}
            {waitlist.length > 0 && (
              <>
                <div className="text-xs text-brand-600 font-semibold pt-2 pb-1">— 候补 —</div>
                {waitlist.map((p, i) => (
                  <div key={p.id}
                    ref={el => { if (el) rowRefs.current.set(p.id, el); else rowRefs.current.delete(p.id) }}>
                    <ParticipantRow p={p} rank={joined.length + i + 1}
                      isAdmin={isAdmin}
                      isLocked={session.status === 'locked' || session.status === 'closed'}
                      allowActions={false}
                      isOwn={currentUser?.id === p.user_id}
                      canEdit={currentUser?.id === p.user_id && session.status !== 'closed' && session.status !== 'canceled'}
                      payRecord={payRecords.find(r => r.participant_id === p.id)}
                      onWithdraw={() => confirmWithdraw(p.id, false)}
                      onToggleLate={() => handleToggleLate(p)}
                      onTogglePayment={() => handleTogglePayment(p.id)}
                      onRename={n => handleRename(p.id, n)} />
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* 改动记录 — joins + withdrawals + renames unified timeline */}
      {(participants.length > 0 || withdrawn.length > 0 || renames.length > 0) && (() => {
        type HistoryItem =
          | { kind: 'join';     p: ParticipantWithProfile; time: string }
          | { kind: 'withdraw'; p: ParticipantWithProfile; time: string }
          | { kind: 'rename';   r: ParticipantRename;      nickname: string; time: string }
        const items: HistoryItem[] = [
          ...participants.map(p => ({ kind: 'join' as const, p, time: p.joined_at ?? '' })),
          ...withdrawn.map(p => ({ kind: 'withdraw' as const, p, time: p.withdrew_at ?? '' })),
          ...renames.map(r => ({
            kind: 'rename' as const, r,
            nickname: participants.find(p => p.user_id === r.user_id)?.profile?.nickname ?? '用户',
            time: r.created_at,
          })),
        ].filter(i => i.time).sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
        return (
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-gray-900 text-sm">改动记录</h2>
              <button
                onClick={() => setHistoryCollapsed(c => !c)}
                className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 transition-transform ${historyCollapsed ? '-rotate-90' : ''}`}>
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/>
                </svg>
              </button>
            </div>
            {!historyCollapsed && (
              <div className="max-h-72 overflow-y-auto rounded-lg overflow-hidden">
                {items.map((item, i) => {
                  const ts = new Date(item.time)
                  const label = `${ts.getMonth()+1}/${ts.getDate()} ${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}`
                  const bg = i % 2 === 0 ? 'bg-gray-50' : 'bg-gray-100'
                  return item.kind === 'join' ? (
                    <div key={`j-${item.p.id}`} className={`px-2 py-1.5 ${bg}`}>
                      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="text-gray-700">{item.p.display_name}</span>
                        <span className="text-xs text-gray-400">加入接龙</span>
                      </div>
                    </div>
                  ) : item.kind === 'withdraw' ? (
                    <div key={item.p.id} className={`px-2 py-1.5 ${bg}`}>
                      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="text-gray-400 line-through">{item.p.display_name}</span>
                        {item.p.status === 'late_withdraw'
                          ? <span className="badge bg-orange-100 text-orange-700">迟退 ⚠️</span>
                          : <span className="text-xs text-gray-400">退出</span>}
                      </div>
                    </div>
                  ) : (
                    <div key={`r-${item.r.id}-${i}`} className={`px-2 py-1.5 ${bg}`}>
                      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                      <p className="text-sm text-gray-600 flex flex-wrap gap-1">
                        <span className="font-medium">{item.nickname}</span>
                        <span>改名：</span>
                        <span className="line-through text-gray-400">{item.r.old_name}</span>
                        <span>→</span>
                        <span className="text-gray-700">{item.r.new_name}</span>
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {/* Stayed-late panel */}
      {(session.status === 'locked' || session.status === 'closed') &&
        participants.some(p => p.stayed_late) && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-1.5">
            <span className="text-orange-500">⏰</span> +时名单（共{participants.filter(p => p.stayed_late).length}人）
          </h2>
          {participants.filter(p => p.stayed_late).map(p => (
            <div key={p.id} className="flex items-center gap-3 py-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={(p as any).profile?.avatar_url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${p.user_id}`}
                alt="" className="w-7 h-7 rounded-full object-cover shrink-0 bg-gray-100"
              />
              <span className="text-sm text-gray-800 flex-1">{p.display_name}</span>
              <span className="badge bg-orange-100 text-orange-700">+时</span>
            </div>
          ))}
        </div>
      )}

      {/* Payment section */}
      {(session.status === 'locked' || session.status === 'closed') && (
        <PaymentSection
          session={session}
          participants={[...joined, ...waitlist]}
          admins={admins}
          paymentMethods={paymentMethods}
          paymentRecords={payRecords}
          currentUserId={currentUser?.id}
          currentUserNickname={currentUser?.profile?.nickname ?? undefined}
          isAdmin={isAdmin && session.status !== 'closed'}
          onMethodAdded={m => setPaymentMethods(prev => [...prev, m])}
          onMethodUpdated={m => setPaymentMethods(prev => prev.map(x => x.id === m.id ? m : x))}
          onMethodRemoved={id => setPaymentMethods(prev => prev.filter(x => x.id !== id))}
          showConfirm={showConfirm}
        />
      )}

      {/* ── Floating participant search overlay (admin, locked) ─────────── */}
      {searchOpen && (
        <>
          {/* Dim backdrop — tap to close */}
          <div className="fixed inset-0 z-40 bg-black/20" onClick={closeSearch} />

          {/* Floating panel anchored to bottom of viewport */}
          <div className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-6">

            {/* Candidates panel — expands upward above the input */}
            {dropdownVisible && searchMatches.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-2xl mb-1
                              overflow-hidden max-h-56 overflow-y-auto">
                {searchMatches.map((p, i) => (
                  <div key={p.id}
                    className={`flex items-center text-sm transition-colors
                                ${i === safeMatchIdx ? 'bg-brand-50' : 'hover:bg-gray-50'}`}>
                    {/* Name area — tap to highlight row in queue */}
                    <button
                      onMouseDown={() => { setMatchIdx(i); setDropdownVisible(false) }}
                      className="flex-1 text-left px-4 py-3 flex items-center gap-3 min-w-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.profile?.avatar_url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${p.user_id}`}
                        alt="" className="w-7 h-7 rounded-full bg-gray-100 shrink-0 object-cover"/>
                      <span className="font-medium truncate">{p.display_name}</span>
                      {p.profile?.nickname && p.profile.nickname !== p.display_name && (
                        <span className="text-xs text-gray-400 truncate">{p.profile.nickname}</span>
                      )}
                      {i === safeMatchIdx && (
                        <span className="ml-auto text-brand-600 shrink-0">
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                          </svg>
                        </span>
                      )}
                    </button>
                    {/* +时 toggle — admin only */}
                    {isAdmin && p.status === 'joined' && (
                      <button
                        onMouseDown={e => { e.preventDefault(); handleToggleLate(p) }}
                        className={`shrink-0 mr-3 text-xs px-2 py-1 rounded-lg font-medium
                          ${p.stayed_late
                            ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                        +时
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* No results hint */}
            {searchQuery.trim() && searchMatches.length === 0 && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-2xl mb-1 px-4 py-3">
                <p className="text-sm text-gray-400">无匹配结果</p>
              </div>
            )}

            {/* Search input bar */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-2xl
                            flex items-center gap-2 px-3 py-2.5">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-gray-400 shrink-0">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
              </svg>
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setMatchIdx(0); setDropdownVisible(true) }}
                type="search"
                placeholder="搜索参与者姓名…"
                className="flex-1 text-sm outline-none bg-transparent"
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              />
              {/* Cycle counter when a match is active */}
              {currentMatchId && searchMatches.length > 0 && (
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs text-gray-400">{safeMatchIdx + 1}/{searchMatches.length}</span>
                  <button onClick={() => setMatchIdx(i => (i - 1 + searchMatches.length) % searchMatches.length)}
                    className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 text-xs">↑</button>
                  <button onClick={() => setMatchIdx(i => (i + 1) % searchMatches.length)}
                    className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 text-xs">↓</button>
                </div>
              )}
              {/* Close */}
              <button onClick={closeSearch}
                className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 shrink-0">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                </svg>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Participant row ────────────────────────────────────────────────────────
function ParticipantRow({
  p, rank, isAdmin, isLocked, allowActions, isOwn, canEdit, payRecord,
  onWithdraw, onToggleLate, onTogglePayment, onRename,
}: {
  p: ParticipantWithProfile
  rank: number
  isAdmin: boolean
  isLocked: boolean      // session is locked/closed — suppresses withdraw
  allowActions: boolean  // true only for joined rows in locked session — enables +时 and payment
  isOwn: boolean
  canEdit?: boolean
  payRecord?: PaymentRecord
  onWithdraw: () => void
  onToggleLate: () => void
  onTogglePayment: () => void
  onRename?: (newName: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(p.display_name)

  function submitEdit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== p.display_name) onRename?.(trimmed)
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-3 py-1.5">
      {/* Rank badge */}
      <span className="w-7 h-7 rounded-full bg-brand-50 text-brand-700 text-xs font-bold
                       flex items-center justify-center shrink-0">
        {rank}
      </span>

      {/* Avatar */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={(p as any).profile?.avatar_url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${p.user_id}`}
        alt=""
        className="w-8 h-8 rounded-full object-cover shrink-0 bg-gray-100"
      />

      {/* Name — editable for own entries */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              className="text-sm border border-brand-300 rounded-lg px-2 py-0.5 flex-1 min-w-0 outline-none focus:ring-1 focus:ring-brand-400"
              value={draft}
              autoFocus
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitEdit(); if (e.key === 'Escape') setEditing(false) }}
            />
            <button onClick={submitEdit} className="text-xs text-brand-600 font-bold px-1">✓</button>
            <button onClick={() => { setDraft(p.display_name); setEditing(false) }} className="text-xs text-gray-400 px-1">✕</button>
          </div>
        ) : (
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-sm font-medium text-gray-900 truncate">{p.display_name}</span>
            {canEdit && !editing && (
              <button onClick={() => { setDraft(p.display_name); setEditing(true) }}
                className="shrink-0 p-0.5 rounded text-gray-300 hover:text-gray-500 active:text-gray-700">
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Stayed late — admin can toggle; own row shows read-only status */}
        {allowActions && (isAdmin || isOwn) && (
          <button
            onClick={isAdmin ? onToggleLate : undefined}
            className={`text-xs px-2 py-1 rounded-lg font-medium
              ${isAdmin ? 'cursor-pointer' : 'cursor-default'}
              ${p.stayed_late
                ? 'bg-orange-100 text-orange-700' + (isAdmin ? ' hover:bg-orange-200' : '')
                : 'bg-gray-100 text-gray-400'      + (isAdmin ? ' hover:bg-gray-200'  : '')}`}>
            +时
          </button>
        )}

        {/* Self-service payment toggle — own joined rows only */}
        {isOwn && allowActions && (
          <button onClick={onTogglePayment}
            className={`text-xs px-2 py-1 rounded-lg font-medium
              ${payRecord?.status === 'paid'
                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                : 'bg-pink-100 text-pink-600 hover:bg-pink-200'}`}>
            {payRecord?.status === 'paid' ? '已付 ✓' : '❗标记已支付'}
          </button>
        )}

        {/* Admin read-only payment badge for others */}
        {isAdmin && !isOwn && allowActions && payRecord && (
          <span className={`text-xs px-2 py-1 rounded-lg font-medium ${
            payRecord.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {payRecord.status === 'paid' ? '已付 ✓' : '未支付'}
          </span>
        )}

        {/* Read-only payment badge — when actions not available but record exists */}
        {!allowActions && payRecord && (
          <span className={`badge ${PAY_CLASS[payRecord.status]}`}>
            {PAY_LABEL[payRecord.status]}
          </span>
        )}

        {/* Withdraw — own entries, session not locked */}
        {isOwn && !isLocked && (
          <button onClick={onWithdraw}
            className="text-xs px-2 py-1 rounded-lg font-medium bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 active:scale-95">
            退出
          </button>
        )}
      </div>
    </div>
  )
}

// ── Payment section ────────────────────────────────────────────────────────
function PaymentSection({
  session, participants, admins, paymentMethods, paymentRecords,
  currentUserId, currentUserNickname, isAdmin, onMethodAdded, onMethodUpdated, onMethodRemoved,
  showConfirm,
}: {
  session: SessionWithInitiator
  participants: ParticipantWithProfile[]
  admins: SessionAdmin[]
  paymentMethods: PaymentMethod[]
  paymentRecords: PaymentRecord[]
  currentUserId?: string
  currentUserNickname?: string
  isAdmin: boolean
  onMethodAdded:   (m: PaymentMethod) => void
  onMethodUpdated: (m: PaymentMethod) => void
  onMethodRemoved: (id: string) => void
  showConfirm: (title: string, message: string, onConfirm: () => void, danger?: boolean) => void
}) {
  const supabase  = createClient()
  const [showForm,        setShowForm]        = useState(false)
  const [editingMethodId, setEditingMethodId] = useState<string | null>(null)
  const [menuOpenId,      setMenuOpenId]      = useState<string | null>(null)
  const [search,    setSearch]    = useState('')
  const [selected,  setSelected]  = useState<ParticipantWithProfile | null>(null)
  const [venmoId,   setVenmoId]   = useState('')
  const [amount,    setAmount]    = useState('')
  const [saving,    setSaving]    = useState(false)
  const [venmoPending, setVenmoPending] = useState<{ accountRef: string; amount?: number | null; note: string } | null>(null)
  const [dropOpen,  setDropOpen]  = useState(false)

  // Merge admins not already in participants into the search pool
  const adminEntries: ParticipantWithProfile[] = admins
    .filter(a => !participants.some(p => p.user_id === a.user_id))
    .map(a => ({
      id: `admin-${a.user_id}`, session_id: session.id, user_id: a.user_id,
      display_name: (a.profile as any)?.nickname ?? a.user_id,
      queue_position: -1, status: 'joined' as const,
      stayed_late: false, joined_at: '', withdrew_at: null,
      profile: { id: a.user_id, nickname: (a.profile as any)?.nickname ?? null,
                 avatar_url: (a.profile as any)?.avatar_url ?? null, venmo_username: null },
    }))

  // Deduplicate participants by user_id for the search dropdown
  const uniqueUsers = [...participants, ...adminEntries].filter(
    (p, i, arr) => arr.findIndex(x => x.user_id === p.user_id) === i
  )
  const filtered = uniqueUsers.filter(p =>
    (p.profile?.nickname ?? p.display_name).toLowerCase().includes(search.toLowerCase())
  )

  function selectUser(p: ParticipantWithProfile) {
    setSelected(p)
    setSearch(p.profile?.nickname ?? p.display_name)
    setVenmoId(p.profile?.venmo_username ?? '')
    setDropOpen(false)
  }

  function resetForm() {
    setShowForm(false); setEditingMethodId(null); setSelected(null)
    setSearch(''); setVenmoId(''); setAmount(''); setDropOpen(false)
  }

  function startEdit(method: PaymentMethod) {
    const match = uniqueUsers.find(p =>
      (p.profile?.nickname ?? p.display_name) === method.label
    )
    setEditingMethodId(method.id)
    setSelected(match ?? null)
    setSearch(method.label)
    setVenmoId(method.account_ref)
    setAmount(method.amount != null ? method.amount.toString() : '')
    setShowForm(true)
    setMenuOpenId(null)
  }

  async function removeMethod(method: PaymentMethod) {
    setMenuOpenId(null)
    showConfirm('删除收款人', `确定删除收款人"${method.label}"？`, () => doRemoveMethod(method))
  }
  async function doRemoveMethod(method: PaymentMethod) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('payment_methods') as any)
      .delete().eq('id', method.id)
    if (!error) onMethodRemoved(method.id)
  }

  async function saveMethod() {
    if (!currentUserId) return
    const parsedAmount = parseFloat(amount)
    const amountVal = isNaN(parsedAmount) || parsedAmount <= 0 ? null : parsedAmount
    setSaving(true)

    if (editingMethodId) {
      // Edit mode: only update amount
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('payment_methods') as any)
        .update({ amount: amountVal })
        .eq('id', editingMethodId)
        .select().single() as { data: PaymentMethod | null; error: unknown }
      setSaving(false)
      if (!error && data) { onMethodUpdated(data); resetForm() }
    } else {
      // Add mode: require user selection and Venmo handle
      const ref = venmoId.trim().replace(/^@/, '')
      if (!ref || !selected) { setSaving(false); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('payment_methods') as any)
        .insert({
          session_id:  session.id,
          type:        'venmo',
          label:       selected.profile?.nickname ?? selected.display_name,
          account_ref: ref,
          amount:      amountVal,
          created_by:  currentUserId,
        })
        .select().single() as { data: PaymentMethod | null; error: unknown }
      setSaving(false)
      if (!error && data) { onMethodAdded(data); resetForm() }
    }
  }

  const allPaid = paymentRecords.length > 0 && paymentRecords.every(r => r.status === 'paid')

  return (
    <div className="card space-y-4">

      {/* Venmo reminder dialog */}
      {venmoPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setVenmoPending(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3">
            <h3 className="text-lg font-bold text-gray-900 flex items-center justify-center gap-1">⚠️ 注意事项</h3>
            <div className="text-sm text-gray-600 leading-relaxed space-y-2 text-center">
              <p>转账后请务必先在 Venmo 里<strong className="text-red-600">确认付款成功</strong>，然后<strong className="text-gray-900">手动在上方接龙的名字旁点击「❗标记已支付」</strong>！</p>
              <p>如果有 +1，请<strong className="text-gray-900">全部付清并更新全部付款状态</strong>，方便对账。</p>
              <p>付款前请提前和 +1 方确认有没有<strong className="text-gray-900">晚场加时</strong>。</p>
              <p>谢谢！</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setVenmoPending(null)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold
                           active:bg-gray-200 transition-colors">
                取消
              </button>
              <button onClick={() => { const p = venmoPending; setVenmoPending(null); openVenmo(p.accountRef, p.amount, p.note) }}
                className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold
                           bg-[#008CFF] active:opacity-80 transition-colors">
                前往 Venmo
              </button>
            </div>
          </div>
        </div>
      )}

      <h2 className="font-semibold text-gray-900">💳 付款</h2>

      {/* All-paid celebration banner */}
      {allPaid && (
        <div className="flex flex-col items-center gap-1 py-2">
          <span className="text-3xl">🎆</span>
          <p className="text-sm font-semibold text-green-600">都已转账！</p>
        </div>
      )}

      {/* Pay-to rows */}
      {paymentMethods.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide">付款给</p>
          {paymentMethods.map(method => (
            <div key={method.id} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {/* Admin settings menu */}
                {isAdmin && (
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setMenuOpenId(menuOpenId === method.id ? null : method.id)}
                      className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400
                                 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"/>
                      </svg>
                    </button>
                    {menuOpenId === method.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
                        <div className="absolute left-0 top-7 z-20 bg-white border border-gray-100
                                        rounded-xl shadow-lg overflow-hidden w-28">
                          <button onClick={() => startEdit(method)}
                            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                            编辑
                          </button>
                          <button onClick={() => removeMethod(method)}
                            className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-50">
                            删除
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{method.label}</p>
                  <p className="text-xs text-gray-400">@{method.account_ref}</p>
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {method.amount != null && (
                  <span className="text-sm font-semibold text-gray-700">${+method.amount.toFixed(2)}/人</span>
                )}
                <button onClick={() => setVenmoPending({ accountRef: method.account_ref, amount: method.amount, note: `${session.title} @${currentUserNickname ?? 'Player'}` })}
                   className="px-3 py-1.5 rounded-lg text-sm font-bold text-white
                              bg-[#008CFF] active:opacity-80 transition-opacity">
                  Venmo 付款
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Admin: add payment receiver */}
      {isAdmin && (
        <div>
          {!showForm ? (
            <button onClick={() => setShowForm(true)} className="text-sm text-brand-600 font-semibold">
              + 添加收款人
            </button>
          ) : (
            <div className="space-y-3 border border-gray-100 rounded-xl p-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {editingMethodId ? '编辑收款人' : '选择收款人'}
              </p>

              {/* Edit mode: only show amount */}
              {editingMethodId ? (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">金额（每人应付）</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      className="input pl-7"
                      placeholder="0.00"
                      inputMode="decimal"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      autoFocus
                    />
                  </div>
                </div>
              ) : (
                <>
                  {/* Add mode: user search + Venmo + amount */}
                  <div className="relative">
                    <input
                      className="input"
                      placeholder="搜索参与者…"
                      value={search}
                      onChange={e => { setSearch(e.target.value); setSelected(null); setDropOpen(true) }}
                      onFocus={() => setDropOpen(true)}
                      autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                    />
                    {dropOpen && search && filtered.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-100
                                      rounded-xl shadow-lg overflow-hidden">
                        {filtered.map(p => (
                          <button key={p.user_id} onMouseDown={() => selectUser(p)}
                            className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50
                                       flex items-center gap-2.5 transition-colors">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={p.profile?.avatar_url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${p.user_id}`}
                              alt="" className="w-6 h-6 rounded-full bg-gray-100 shrink-0"
                            />
                            <span className="font-medium">{p.profile?.nickname ?? p.display_name}</span>
                            {p.profile?.venmo_username && (
                              <span className="text-xs text-gray-400 ml-auto">@{p.profile.venmo_username}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {selected && (
                    <>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">
                          Venmo ID
                          {selected.profile?.venmo_username
                            ? <span className="ml-1 text-brand-600">（来自个人资料）</span>
                            : <span className="ml-1 text-orange-500">（未设置，请手动填写）</span>
                          }
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
                          <input
                            className="input pl-7"
                            placeholder="venmo-handle"
                            value={venmoId}
                            onChange={e => setVenmoId(e.target.value.replace(/^@/, ''))}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">金额（每人应付）</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                          <input
                            className="input pl-7"
                            placeholder="0.00"
                            inputMode="decimal"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}

              <div className="flex gap-2">
                <button onClick={saveMethod}
                  disabled={saving || (!editingMethodId && (!selected || !venmoId.trim()))}
                  className="flex-1 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold
                             disabled:opacity-40 transition-opacity">
                  {saving ? '保存中…' : editingMethodId ? '保存' : '添加'}
                </button>
                <button onClick={resetForm}
                  className="flex-1 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-semibold">
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
}

// ── Share button ──────────────────────────────────────────────────────────
function ShareButton({ sessionId, title }: { sessionId: string; title: string }) {
  const [copied, setCopied] = useState(false)

  async function share() {
    const url = `${location.origin}/sessions/${sessionId}`
    if (navigator.share) {
      await navigator.share({ title, url })
    } else {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button onClick={share} title="分享邀请链接"
      className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors
                 text-gray-400 hover:text-gray-600 hover:bg-gray-100 active:bg-gray-200">
      {copied ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-green-500">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
          <polyline points="16 6 12 2 8 6"/>
          <line x1="12" y1="2" x2="12" y2="15"/>
        </svg>
      )}
    </button>
  )
}
