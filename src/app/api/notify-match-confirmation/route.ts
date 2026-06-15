export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gamesWon, scoreLine, teamPlayers } from '@/lib/match'
import type { MatchGame, MatchParticipant } from '@/lib/types'

export async function POST(req: NextRequest) {
  if (process.env.ENABLE_EMAIL !== 'true') return NextResponse.json({ ok: true, skipped: true })

  const { matchId } = await req.json()
  if (!matchId) return NextResponse.json({ error: 'Missing matchId' }, { status: 400 })

  const supabase = await createClient()
  const { data: match } = await supabase
    .from('matches')
    .select(`
      id, type, status, recorder_id,
      recorder:profiles!recorder_id(nickname),
      participants:match_participants(id, user_id, is_recorder, is_guest, team, confirmed, display_name),
      games:match_games(game_no, team1_score, team2_score)
    `)
    .eq('id', matchId)
    .single()

  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  if (match.status !== 'pending') return NextResponse.json({ ok: true, skipped: 'not pending' })

  const participants = (match.participants ?? []) as unknown as MatchParticipant[]
  const games        = (match.games ?? []) as unknown as MatchGame[]

  // Recipients: registered, non-recorder participants who still need to confirm.
  const recipients = participants.filter(p => !p.is_recorder && !p.is_guest && !p.confirmed && p.user_id)
  if (recipients.length === 0) return NextResponse.json({ ok: true, sent: 0 })

  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  if (!gmailUser || !gmailPass) return NextResponse.json({ error: 'Email not configured' }, { status: 500 })

  const admin = createAdminClient()
  const emails: string[] = []
  for (const p of recipients) {
    const { data } = await admin.auth.admin.getUserById(p.user_id as string)
    if (data.user?.email) emails.push(data.user.email)
  }
  if (emails.length === 0) return NextResponse.json({ ok: true, sent: 0 })

  const recorderName = (match.recorder as unknown as { nickname: string } | null)?.nickname ?? '菜狗成员'
  const won   = gamesWon(games)
  const t1    = teamPlayers(participants, 1).map(p => p.display_name).join(' & ')
  const t2    = teamPlayers(participants, 2).map(p => p.display_name).join(' & ')
  const url   = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://vegedog-badminton-webapp.vercel.app'}/versus`
  const subject = `${recorderName} 录入了一场对局，请确认结果`
  const body =
`您好，

${recorderName} 录入了一场${match.type === 'singles' ? '单打' : '双打'}对局，需要您确认结果：

${t1}  ${won.team1} - ${won.team2}  ${t2}
比分：${scoreLine(games)}

请在 app 内打开「对战」确认（全员确认后才会正式发布并计分）：
${url}

-菜狗群AI管理员`

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass },
  })

  await transporter.sendMail({
    from: `菜狗羽球 <${gmailUser}>`,
    to: emails.join(', '),
    subject,
    text: body,
  })

  return NextResponse.json({ ok: true, sent: emails.length })
}
