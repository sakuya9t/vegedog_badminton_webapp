export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const { sessionId } = await req.json()
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

  const supabase = await createClient()

  // Fetch session details
  const { data: session } = await supabase
    .from('sessions')
    .select('id, title, location, starts_at, initiator_id, initiator:profiles!initiator_id(nickname)')
    .eq('id', sessionId)
    .single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // Fetch followers of the initiator
  const { data: follows } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('following_id', session.initiator_id)
  if (!follows || follows.length === 0) return NextResponse.json({ ok: true, sent: 0 })

  const followerIds = follows.map(f => f.follower_id)
  const initiatorName = (session.initiator as any)?.nickname ?? '菜狗成员'
  const admin = createAdminClient()

  // In-app station letters for every follower (service role bypasses RLS insert).
  await admin.from('notifications').insert(
    followerIds.map(uid => ({
      user_id: uid,
      type: 'follow_session',
      title: `${initiatorName} 开启了新接龙`,
      body: session.title,
      link: `/sessions/${session.id}`,
    })),
  )

  // Email only followers who haven't opted out, and only when email is enabled.
  if (process.env.ENABLE_EMAIL !== 'true') return NextResponse.json({ ok: true, notified: followerIds.length })

  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  if (!gmailUser || !gmailPass) return NextResponse.json({ ok: true, notified: followerIds.length, emailSkipped: 'not configured' })

  const { data: optedIn } = await supabase
    .from('profiles')
    .select('id')
    .in('id', followerIds)
    .eq('notify_follow', true)
  const recipientIds = (optedIn ?? []).map(p => p.id)
  if (recipientIds.length === 0) return NextResponse.json({ ok: true, notified: followerIds.length, sent: 0 })

  const emails: string[] = []
  for (const uid of recipientIds) {
    const { data } = await admin.auth.admin.getUserById(uid)
    if (data.user?.email) emails.push(data.user.email)
  }
  if (emails.length === 0) return NextResponse.json({ ok: true, notified: followerIds.length, sent: 0 })

  const sessionUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://vegedog-badminton-webapp.vercel.app'}/sessions/${session.id}`
  const subject = `${initiatorName} 开启了新的接龙！`
  const body = `您好，\n\n您关注的 ${initiatorName} 开启了新的接龙：\n\n${session.title}\n📍 ${session.location}\n\n点击参加：${sessionUrl}\n\n-菜狗群AI管理员`

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

  return NextResponse.json({ ok: true, notified: followerIds.length, sent: emails.length })
}
