import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import NavbarActions from './NavbarActions'

export default async function Navbar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let profile: { nickname: string; avatar_url: string | null } | null = null
  if (user) {
    const { data } = await supabase.from('profiles').select('nickname, avatar_url').eq('id', user.id).single()
    profile = data as { nickname: string; avatar_url: string | null } | null
  }
  const avatarSrc = profile?.avatar_url ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${user?.id}`

  return (
    <header className="sticky top-0 z-40 backdrop-blur border-b" style={{ background: 'hsl(35, 40%, 97%)', borderColor: 'hsl(35, 20%, 85%)' }}>
      <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/sessions" className="flex items-center gap-2 font-bold text-gray-900">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
            <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          </svg>
          <span>菜狗主页</span>
        </Link>
        <NavbarActions loggedIn={!!user} avatarSrc={avatarSrc} userId={user?.id ?? null} />
      </div>
    </header>
  )
}
