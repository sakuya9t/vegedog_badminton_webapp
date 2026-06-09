export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatSessionDate } from '@/lib/dates'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.nextUrl.searchParams.get('secret') !== secret)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (process.env.ENABLE_EMAIL !== 'true') return NextResponse.json({ ok: true, skipped: true })

  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  if (!gmailUser || !gmailPass) return NextResponse.json({ error: 'Email not configured' }, { status: 500 })

  const admin = createAdminClient()

  // Triggered daily at 6am by cron-job.org — emails every unpaid participant
  // in every locked session until they mark themselves as paid.
  const { data: sessions } = await admin
    .from('sessions')
    .select('id, title, starts_at, location')
    .eq('status', 'locked')

  if (!sessions?.length) return NextResponse.json({ ok: true, count: 0 })

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: gmailUser, pass: gmailPass },
  })

  let sent = 0

  for (const session of sessions) {
    // Find unpaid participants
    const { data: records } = await admin
      .from('payment_records')
      .select('id, participant_id')
      .eq('session_id', session.id)
      .eq('status', 'unpaid')

    if (!records?.length) continue

    // Get user_ids for these participants
    const { data: participants } = await admin
      .from('participants')
      .select('id, user_id, display_name')
      .in('id', records.map(r => r.participant_id))

    if (!participants?.length) continue

    const sessionUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://vegedog-badminton-webapp.vercel.app'}/sessions/${session.id}`
    const dateStr = formatSessionDate(session.starts_at)

    for (const participant of participants) {
      if (!participant.user_id) continue

      const { data: { user } } = await admin.auth.admin.getUserById(participant.user_id)
      if (!user?.email) continue

      await transporter.sendMail({
        from: `菜狗羽球 <${gmailUser}>`,
        to: user.email,
        subject: `💰 付款提醒 — ${session.title}`,
        text: `${participant.display_name} 您好，\n\n您在「${session.title}」（${dateStr}）中尚未完成付款。\n\n请完成转账后在接龙页面点击「❗标记已支付」。\n\n查看接龙：${sessionUrl}\n\n-菜狗群AI管理员`,
      })

      sent++
    }
  }

  return NextResponse.json({ ok: true, count: sent })
}
