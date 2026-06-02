import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Keeps Supabase projects alive (free tier pauses after 1 week of inactivity)
export async function GET() {
  const supabase = await createClient()
  await supabase.from('profiles').select('id').limit(1)

  // Also ping dev project if configured
  const devUrl = process.env.SUPABASE_DEV_URL
  const devKey = process.env.SUPABASE_DEV_ANON_KEY
  if (devUrl && devKey) {
    await fetch(`${devUrl}/rest/v1/profiles?select=id&limit=1`, {
      headers: { apikey: devKey, Authorization: `Bearer ${devKey}` },
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
