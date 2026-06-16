import { test, expect, Page } from '@playwright/test'
import { authAs } from '../playwright.config'
import { TEST_USERS } from './test-users'

// User nicknames are stable across runs (seeded). authAs(n) is 1-based, so
// TEST_USERS[n-1] is that user's profile.
const U1 = TEST_USERS[0].nickname  // recorder (default storageState = user1)
const U2 = TEST_USERS[1].nickname  // registered opponent

// ── Create a singles match against a registered opponent ─────────────────────
// Lands on the match detail page (draft) and returns its URL.
async function createSinglesMatch(page: Page, opponentNickname: string): Promise<string> {
  await page.goto('/versus/new')

  // Singles (default is doubles)
  await page.locator('button', { hasText: '单打' }).click()

  // Pick the opponent via the nickname search dropdown
  await page.fill('input[placeholder="搜索对手昵称…"]', opponentNickname)
  // The candidate button's accessible name is exactly the nickname (the guest
  // fallback button reads "使用「…」为访客", so an exact match disambiguates).
  await page.getByRole('button', { name: opponentNickname, exact: true }).click()

  await page.locator('button', { hasText: '创建并录入比分' }).click()
  await page.waitForURL(/\/versus\/[a-f0-9-]{36}$/, { timeout: 10_000 })
  return page.url()
}

// Fill the first game's scores on the detail page.
async function enterScore(page: Page, t1: number, t2: number) {
  const inputs = page.locator('input[type="number"]')
  await inputs.nth(0).fill(String(t1))
  await inputs.nth(1).fill(String(t2))
}

test.describe('Versus — match lifecycle', () => {
  test('create singles match, enter score, request confirmation', async ({ page }) => {
    await createSinglesMatch(page, U2)

    await enterScore(page, 21, 15)

    // Email opt-in must default to OFF.
    const emailCheckbox = page.locator('input[type="checkbox"]')
    await expect(emailCheckbox).not.toBeChecked()

    await page.locator('button', { hasText: '发送确认请求' }).click()

    // draft → pending: recorder sees the waiting banner and a 待确认 progress.
    await expect(page.getByText('等待对方确认')).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText(/待确认 0\/1/)).toBeVisible()
  })

  test('toggle visibility to 不公开 on a draft', async ({ page }) => {
    await createSinglesMatch(page, U2)

    // Switch to 不公开 in the 公开性 control.
    await page.locator('button', { hasText: '不公开' }).click()

    // The explanatory copy reflects the private state.
    await expect(page.getByText('仅参与方可在对战历史看到。')).toBeVisible({ timeout: 5_000 })
  })

  test('full lifecycle: recorder requests, opponent confirms → published', async ({ browser }) => {
    test.setTimeout(60_000)

    // ── Recorder (user1) creates the match and requests confirmation ─────────
    const recCtx  = await browser.newContext({ storageState: authAs(1) })
    const recPage = await recCtx.newPage()
    const matchUrl = await createSinglesMatch(recPage, U2)
    await enterScore(recPage, 21, 18)
    await recPage.locator('button', { hasText: '发送确认请求' }).click()
    await expect(recPage.getByText('等待对方确认')).toBeVisible({ timeout: 8_000 })

    // ── Opponent (user2) confirms from the 待你确认 list ─────────────────────
    const oppCtx  = await browser.newContext({ storageState: authAs(2) })
    const oppPage = await oppCtx.newPage()
    await oppPage.goto('/versus')
    await expect(oppPage.getByText('待你确认')).toBeVisible({ timeout: 8_000 })
    await oppPage.locator('button', { hasText: '确认对局' }).first().click()
    await oppCtx.close()

    // ── Recorder sees it published (all confirmed) ───────────────────────────
    await recPage.goto(matchUrl)
    await expect(recPage.getByText('已全员确认并发布')).toBeVisible({ timeout: 8_000 })
    await recCtx.close()
  })
})
