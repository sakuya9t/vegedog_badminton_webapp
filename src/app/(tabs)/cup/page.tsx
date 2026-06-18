import Link from 'next/link'

export default function CupPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">菜狗杯</h1>

      <div className="card text-center py-10 space-y-3">
        <p className="text-4xl">🏆</p>
        <p className="font-semibold text-gray-600">菜狗杯 · 即将上线</p>
        <p className="text-sm text-gray-400 max-w-sm mx-auto">
          菜狗杯是单独的赛事（tournament）：报名、分组对阵、淘汰赛与最终名次。敬请期待。
        </p>
        <ul className="text-sm text-gray-400 space-y-1.5 inline-block text-left">
          <li>🎫 报名与签到</li>
          <li>🎯 按积分蛇形分组</li>
          <li>🪜 对阵表 / 淘汰赛</li>
          <li>🏅 冠军与最终名次</li>
        </ul>
      </div>

      <Link href="/versus?tab=leaderboard"
        className="card flex items-center justify-between transition-colors hover:bg-gray-50 active:bg-gray-100">
        <div>
          <p className="text-sm font-semibold text-gray-700">对战排行榜</p>
          <p className="text-xs text-gray-400 mt-0.5">日常对局的综合 ELO 排名（已上线）</p>
        </div>
        <span className="text-gray-300 text-sm">查看 ›</span>
      </Link>
    </main>
  )
}
