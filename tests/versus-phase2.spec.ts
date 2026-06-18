import { test, expect, Page, Browser } from '@playwright/test'
import { authAs } from '../playwright.config'
import { TEST_USERS } from './test-users'

// Seeded, stable nicknames. authAs(n) is 1-based → TEST_USERS[n-1].
const U1 = TEST_USERS[0].nickname  // recorder (default storageState = user1)
const U2 = TEST_USERS[1].nickname  // registered opponent

// ── Helpers (mirrors versus.spec.ts; specs stay self-contained) ──────────────
async function createSinglesMatch(page: Page, opponentNickname: string): Promise<string> {
  await page.goto('/versus/new')
  await page.locator('button', { hasText: '单打' }).click()
  await page.fill('input[placeholder="搜索对手昵称…"]', opponentNickname)
  await page.getByRole('button', { name: opponentNickname, exact: true }).click()
  await page.locator('button', { hasText: '创建并录入比分' }).click()
  await page.waitForURL(/\/versus\/[a-f0-9-]{36}$/, { timeout: 10_000 })
  return page.url()
}

async function enterScore(page: Page, t1: number, t2: number) {
  const inputs = page.locator('input[type="number"]')
  await inputs.nth(0).fill(String(t1))
  await inputs.nth(1).fill(String(t2))
}

// Drive a singles match from creation to published (recorder=user1, opponent=user2).
// Returns the match id.
async function publishSinglesMatch(browser: Browser, t1: number, t2: number): Promise<string> {
  const recCtx  = await browser.newContext({ storageState: authAs(1) })
  const recPage = await recCtx.newPage()
  const matchUrl = await createSinglesMatch(recPage, U2)
  const matchId  = matchUrl.split('/').pop() as string
  await enterScore(recPage, t1, t2)
  await recPage.locator('button', { hasText: '发送确认请求' }).click()
  await expect(recPage.getByText('等待对方确认')).toBeVisible({ timeout: 8_000 })

  const oppCtx  = await browser.newContext({ storageState: authAs(2) })
  const oppPage = await oppCtx.newPage()
  await oppPage.goto('/versus')
  const card = oppPage.locator(`[data-match-id="${matchId}"]`)
  await expect(card.locator('button', { hasText: '确认对局' })).toBeVisible({ timeout: 8_000 })
  await card.locator('button', { hasText: '确认对局' }).click()
  await expect(oppPage.locator(`[data-match-id="${matchId}"] button:has-text("确认对局")`))
    .toHaveCount(0, { timeout: 8_000 })
  await oppCtx.close()
  await recCtx.close()
  return matchId
}

test.describe('Versus Phase 2 — ratings & 排行榜', () => {
  test('publishing populates the leaderboard and the player rating card', async ({ browser }) => {
    test.setTimeout(60_000)
    await publishSinglesMatch(browser, 21, 9)

    const ctx  = await browser.newContext({ storageState: authAs(1) })
    const page = await ctx.newPage()

    // 排行榜 sub-tab shows the leaderboard with both players.
    await page.goto('/versus')
    await page.getByRole('button', { name: '排行榜' }).click()
    await expect(page.getByText('对战排行榜')).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText(U2).first()).toBeVisible()

    // Tapping the recorder's row opens their profile, which now shows a real
    // rating (the "对战 ELO · N 局" subtitle only renders once a rating exists).
    await page.getByRole('link', { name: new RegExp(U1) }).first().click()
    await page.waitForURL(/\/players\//, { timeout: 8_000 })
    await expect(page.getByText(/对战 ELO · \d+ 局/)).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText('暂无积分')).toHaveCount(0)

    await ctx.close()
  })

  test('grouping helper splits rated players into groups', async ({ browser }) => {
    test.setTimeout(60_000)
    // Ensure at least one rated player exists.
    await publishSinglesMatch(browser, 21, 14)

    const ctx  = await browser.newContext({ storageState: authAs(1) })
    const page = await ctx.newPage()
    await page.goto('/versus')
    await page.getByRole('button', { name: '排行榜' }).click()
    await expect(page.getByText('分组助手')).toBeVisible({ timeout: 8_000 })

    // Off by default; choosing "2 组" renders the group cards.
    await page.getByRole('button', { name: '2 组' }).click()
    await expect(page.getByText('第 1 组')).toBeVisible()
    await expect(page.getByText('第 2 组')).toBeVisible()

    await ctx.close()
  })
})

test.describe('Versus Phase 2 — 站内信 (notifications)', () => {
  test('confirm-request and publish each create a station letter', async ({ browser }) => {
    test.setTimeout(60_000)

    // ── Recorder requests confirmation ───────────────────────────────────────
    const recCtx  = await browser.newContext({ storageState: authAs(1) })
    const recPage = await recCtx.newPage()
    const matchUrl = await createSinglesMatch(recPage, U2)
    const matchId  = matchUrl.split('/').pop() as string
    await enterScore(recPage, 21, 7)
    await recPage.locator('button', { hasText: '发送确认请求' }).click()
    await expect(recPage.getByText('等待对方确认')).toBeVisible({ timeout: 8_000 })

    // ── Opponent has an unread bell + a 'match_confirm' letter ────────────────
    const oppCtx  = await browser.newContext({ storageState: authAs(2) })
    const oppPage = await oppCtx.newPage()
    await oppPage.goto('/versus')
    // Unread badge on the navbar bell.
    await expect(oppPage.locator('a[aria-label="通知"] span').first()).toBeVisible({ timeout: 8_000 })
    await oppPage.goto('/notifications')
    await expect(oppPage.getByText('有对局待你确认').first()).toBeVisible({ timeout: 8_000 })

    // ── Opponent confirms → match publishes ──────────────────────────────────
    await oppPage.goto('/versus')
    const card = oppPage.locator(`[data-match-id="${matchId}"]`)
    await expect(card.locator('button', { hasText: '确认对局' })).toBeVisible({ timeout: 8_000 })
    await card.locator('button', { hasText: '确认对局' }).click()
    await expect(oppPage.locator(`[data-match-id="${matchId}"] button:has-text("确认对局")`))
      .toHaveCount(0, { timeout: 8_000 })

    // ── Both sides get a 'match_published' letter ─────────────────────────────
    await oppPage.goto('/notifications')
    await expect(oppPage.getByText('对局已发布').first()).toBeVisible({ timeout: 8_000 })

    await recPage.goto('/notifications')
    await expect(recPage.getByText('对局已发布').first()).toBeVisible({ timeout: 8_000 })

    await oppCtx.close()
    await recCtx.close()
  })
})
