export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const { sessionId, promotedUserId } = await req.json()
  if (!sessionId || !promotedUserId) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  const supabase = await createClient()

  // Verify the user is actually now joined (not still waitlisted — could have been a waitlist withdrawal)
  const { data: participant } = await supabase
    .from('participants')
    .select('status, display_name')
    .eq('session_id', sessionId)
    .eq('user_id', promotedUserId)
    .eq('status', 'joined')
    .maybeSingle()

  if (!participant) return NextResponse.json({ ok: true, skipped: true })

  const { data: session } = await supabase
    .from('sessions')
    .select('title, starts_at, location')
    .eq('id', sessionId)
    .single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const admin = createAdminClient()

  // In-app station letter (always, regardless of email opt-out).
  await admin.from('notifications').insert({
    user_id: promotedUserId,
    type: 'waitlist_promoted',
    title: '你已递补为正式成员',
    body: `「${session.title}」候补递补成功`,
    link: `/sessions/${sessionId}`,
  })

  // Email, gated by the recipient's opt-out preference and the global switch.
  if (process.env.ENABLE_EMAIL !== 'true') return NextResponse.json({ ok: true, notified: true })

  const { data: pref } = await supabase
    .from('profiles')
    .select('notify_promoted')
    .eq('id', promotedUserId)
    .single()
  if (pref && pref.notify_promoted === false) {
    return NextResponse.json({ ok: true, notified: true, emailSkipped: 'opted_out' })
  }

  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  if (!gmailUser || !gmailPass) return NextResponse.json({ ok: true, notified: true, emailSkipped: 'not configured' })

  const { data: { user } } = await admin.auth.admin.getUserById(promotedUserId)
  if (!user?.email) return NextResponse.json({ ok: true, notified: true, emailSkipped: 'no email' })

  const sessionUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://vegedog-badminton-webapp.vercel.app'}/sessions/${sessionId}`

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: gmailUser, pass: gmailPass },
  })

  await transporter.sendMail({
    from: `菜狗羽球 <${gmailUser}>`,
    to: user.email,
    subject: `🎉 你已从候补递补为正式成员！— ${session.title}`,
    text: `您好，\n\n好消息！您在「${session.title}」中已从候补队列递补为正式成员。\n\n📍 ${session.location}\n\n点击查看接龙：${sessionUrl}\n\n-菜狗群AI管理员`,
  })

  return NextResponse.json({ ok: true })
}
