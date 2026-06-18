import { redirect } from 'next/navigation'

// 历史 was merged into the 接龙 tab (进行中 / 历史 sub-tabs). Keep this route as a
// redirect for old links and the post-close navigation.
export default function HistoryRedirect() {
  redirect('/sessions?tab=history')
}
