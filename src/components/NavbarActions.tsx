'use client'

import Link from 'next/link'
import NotificationBell from './NotificationBell'

interface Props {
  loggedIn: boolean
  avatarSrc: string
  userId: string | null
}

export default function NavbarActions({ loggedIn, avatarSrc, userId }: Props) {
  if (!loggedIn) {
    return (
      <Link href="/login"
        className="text-sm font-semibold text-brand-600 border border-brand-200 px-3 py-1.5 rounded-lg">
        登录
      </Link>
    )
  }

  return (
    <div className="flex items-center gap-1">
      {userId && <NotificationBell userId={userId} />}
      <Link href="/settings" className="flex items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatarSrc} alt="" className="w-7 h-7 rounded-full object-cover bg-gray-100" />
      </Link>
    </div>
  )
}
