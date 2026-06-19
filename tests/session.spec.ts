import { test, expect, Browser } from '@playwright/test'
import { authAs } from '../playwright.config'

function shortId() {
  return Math.random().toString(36).slice(2, 8)
}

// ── Create a session and return its URL ────────────────────────────────────
async function createTestSession(page: import('@playwright/test').Page) {
  const id = shortId()
  await page.goto('/sessions/new')

  await page.fill('input[placeholder="周五菜狗"]', `E2E 测试场次 ${id}`)

  // CBA (Synergy Mission) is pre-selected by default — no action needed.
  // Start time / withdraw deadline use the form's valid defaults
  // (next Friday 8pm + deadline 2 days prior), set via the DateTimePicker.

  await page.fill('input[type="number"][min="1"][max="20"]', '2')   // courts
  await page.fill('input[type="number"][min="1"][max="200"]', '4')  // max participants

  await page.click('button[type="submit"]')
  await page.waitForURL(/\/sessions\/[a-f0-9-]{36}$/, { timeout: 10_000 })
  return page.url()
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Session lifecycle', () => {
  test('create a session', async ({ page }) => {
    await createTestSession(page)
    await expect(page.locator('h1, h2').filter({ hasText: 'E2E 测试场次' }).first()).toBeVisible()
    await expect(page.getByText('正在接龙')).toBeVisible()
  })

  test('join session with own name', async ({ page }) => {
    const sessionUrl = await createTestSession(page)
    await page.goto(sessionUrl)

    // The join input should be pre-filled with the user's nickname
    const joinBtn = page.locator('button', { hasText: /以".*"加入/ })
    await expect(joinBtn).toBeVisible()
    await joinBtn.click()

    await expect(page.getByText('已加入！🎉')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('text=已报名（1/')).toBeVisible()
  })

  test('join with +1 (different name)', async ({ page }) => {
    const sessionUrl = await createTestSession(page)
    await page.goto(sessionUrl)

    // Join own name first
    await page.locator('button', { hasText: /以".*"加入/ }).click()
    await expect(page.getByText('已加入！🎉')).toBeVisible({ timeout: 5_000 })

    // Change name and join again as +1
    // button is a direct child of the card div — one level up reaches the card
    const input = page.locator('button', { hasText: /以".*"加入/ }).locator('..').locator('input')
    await input.fill('E2E 小明')
    await page.locator('button', { hasText: /以".*"加入/ }).click()
    await expect(page.getByText('已加入！🎉')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('text=已报名（2/')).toBeVisible()
  })

  test('withdraw from session', async ({ page }) => {
    const sessionUrl = await createTestSession(page)
    await page.goto(sessionUrl)

    await page.locator('button', { hasText: /以".*"加入/ }).click()
    await expect(page.getByText('已加入！🎉')).toBeVisible({ timeout: 5_000 })

    // Click the 退出 button on own participant row
    await page.locator('button', { hasText: '退出' }).first().click()
    await page.locator('button', { hasText: '确定' }).click()   // confirm 退出 dialog
    await expect(page.getByText('已退出')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('text=已报名（0/')).toBeVisible()
  })

  test('waitlist kicks in when session is full', async ({ page }) => {
    await page.goto('/sessions/new')

    await page.fill('input[placeholder="周五菜狗"]', `E2E 候补测试 ${shortId()}`)
    // CBA pre-selected; date/time use the form's valid defaults.
    await page.fill('input[type="number"][min="1"][max="20"]', '1')   // 1 court
    await page.fill('input[type="number"][min="1"][max="200"]', '1')  // max 1 person

    await page.click('button[type="submit"]')
    await page.waitForURL(/\/sessions\/[a-f0-9-]{36}$/)

    // Join as self (fills the 1 spot)
    await page.locator('button', { hasText: /以".*"加入/ }).click()
    await expect(page.getByText('已加入！🎉')).toBeVisible({ timeout: 5_000 })

    // Join as +1 (should go to waitlist)
    const input = page.locator('button', { hasText: /以".*"加入/ }).locator('..').locator('input')
    await input.fill('E2E 候补者')
    await page.locator('button', { hasText: /以".*"加入/ }).click()
    await expect(page.getByText('已加入！🎉')).toBeVisible({ timeout: 5_000 })

    // Waitlist section should appear
    await expect(page.getByText('— 候补 —')).toBeVisible()
  })

  test('lock session and mark 加时', async ({ page }) => {
    const sessionUrl = await createTestSession(page)
    await page.goto(sessionUrl)

    // Join first
    await page.locator('button', { hasText: /以".*"加入/ }).click()
    await expect(page.getByText('已加入！🎉')).toBeVisible({ timeout: 5_000 })

    // Lock
    await page.locator('button', { hasText: '🔒 锁定接龙' }).click()
    await page.locator('button', { hasText: '确定' }).click()   // confirm 锁定 dialog
    await expect(page.getByText('已锁定')).toBeVisible({ timeout: 5_000 })

    // Mark 加时 on own row
    const lateBtn = page.locator('button', { hasText: '+时' }).first()
    await expect(lateBtn).toBeVisible()
    await lateBtn.click()
    await page.locator('button', { hasText: '确定' }).click()   // confirm 加时 dialog
    // Button should now be highlighted (active/orange state)
    await expect(lateBtn).toHaveClass(/orange/, { timeout: 3_000 })
  })

  test('lock session and toggle payment status', async ({ page }) => {
    const sessionUrl = await createTestSession(page)
    await page.goto(sessionUrl)

    await page.locator('button', { hasText: /以".*"加入/ }).click()
    await expect(page.getByText('已加入！🎉')).toBeVisible({ timeout: 5_000 })

    await page.locator('button', { hasText: '🔒 锁定接龙' }).click()
    await page.locator('button', { hasText: '确定' }).click()   // confirm 锁定 dialog
    await expect(page.getByText('已锁定')).toBeVisible({ timeout: 5_000 })

    // Payment record should appear as ❗标记已支付
    const payBtn = page.locator('button', { hasText: '❗标记已支付' }).first()
    await expect(payBtn).toBeVisible()

    // Toggle to paid
    await payBtn.click()
    await expect(page.locator('button', { hasText: '已付 ✓' }).first()).toBeVisible({ timeout: 5_000 })

    // Toggle back to unpaid
    await page.locator('button', { hasText: '已付 ✓' }).first().click()
    await expect(page.locator('button', { hasText: '❗标记已支付' }).first()).toBeVisible({ timeout: 5_000 })
  })

  test('close session after locking', async ({ page }) => {
    const sessionUrl = await createTestSession(page)
    await page.goto(sessionUrl)

    await page.locator('button', { hasText: /以".*"加入/ }).click()
    await expect(page.getByText('已加入！🎉')).toBeVisible({ timeout: 5_000 })

    await page.locator('button', { hasText: '🔒 锁定接龙' }).click()
    await page.locator('button', { hasText: '确定' }).click()   // confirm 锁定 dialog
    await expect(page.getByText('已锁定')).toBeVisible({ timeout: 5_000 })

    await page.locator('button', { hasText: '移动到历史' }).click()
    // Confirm dialog appears — wait for it then click 确定
    await expect(page.getByText('接龙将进入只读状态')).toBeVisible({ timeout: 5_000 })
    await page.locator('button', { hasText: '确定' }).click()
    // After closing, app navigates to the 接龙 tab's 历史 sub-view.
    await page.waitForURL('**/sessions?tab=history', { timeout: 8_000 })
    await expect(page.locator('text=E2E 测试场次').first()).toBeVisible()
  })
})

// ── Multi-user queue test ─────────────────────────────────────────────────────
// User 1 creates a session (max 8). Users 1–15 join sequentially.
// Sequential order is required: pg_advisory_xact_lock serialises joins on the server
// but the client-visible order depends on which request arrives first, so parallel
// joins produce a non-deterministic queue. Sequential joins guarantee:
//   joined  = users 1–8   (queue positions 1–8)
//   waitlist = users 9–15  (queue positions 9–15)
// After users 1, 2, 3 withdraw, the DB auto-promotes 9 → 11 into joined:
//   joined  = {4, 5, 6, 7, 8, 9, 10, 11}   (8 total)
//   waitlist = {12, 13, 14, 15}              (4 total)
// Then: admin locks, marks first 4 joined rows as +时, users 4–9 self-toggle payment.

test.describe('Multi-user queue & waitlist promotion', () => {
  const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

  async function joinAs(browser: Browser, userIndex: number, sessionUrl: string) {
    const ctx  = await browser.newContext({ storageState: authAs(userIndex) })
    const page = await ctx.newPage()
    await page.goto(sessionUrl)
    await page.locator('button', { hasText: /以".*"加入/ }).click()
    await expect(page.getByText('已加入！🎉')).toBeVisible({ timeout: 8_000 })
    await ctx.close()
  }

  async function withdrawAs(browser: Browser, userIndex: number, sessionUrl: string) {
    const ctx  = await browser.newContext({ storageState: authAs(userIndex) })
    const page = await ctx.newPage()
    await page.goto(sessionUrl)
    await page.locator('button', { hasText: '退出' }).first().click()
    await page.locator('button', { hasText: '确定' }).click()   // confirm 退出 dialog
    await expect(page.getByText('已退出')).toBeVisible({ timeout: 8_000 })
    await ctx.close()
  }

  async function markPaidAs(browser: Browser, userIndex: number, sessionUrl: string) {
    const ctx  = await browser.newContext({ storageState: authAs(userIndex) })
    const page = await ctx.newPage()
    await page.goto(sessionUrl)
    await page.locator('button', { hasText: '❗标记已支付' }).first().click()
    await expect(page.locator('button', { hasText: '已付 ✓' }).first()).toBeVisible({ timeout: 5_000 })
    await ctx.close()
  }

  test('15 users join (cap 8) then 3 withdraw — waitlist promotes correctly', async ({ browser }) => {
    test.setTimeout(120_000)
    // ── Create session as user 1 ──────────────────────────────────────────
    const ctx1  = await browser.newContext({ storageState: authAs(1) })
    const page1 = await ctx1.newPage()
    await page1.goto(`${BASE}/sessions/new`)

    const sessionName = `E2E 多人测试 ${shortId()}`
    await page1.fill('input[placeholder="周五菜狗"]', sessionName)
    // Date/time use the form's valid defaults.
    await page1.fill('input[type="number"][min="1"][max="20"]', '2')   // courts
    await page1.fill('input[type="number"][min="1"][max="200"]', '8')  // max 8
    await page1.click('button[type="submit"]')
    await page1.waitForURL(/\/sessions\/[a-f0-9-]{36}$/, { timeout: 10_000 })
    const sessionUrl = page1.url()
    await ctx1.close()

    // ── Users 1–15 join sequentially ─────────────────────────────────────
    // Sequential order guarantees users 1–8 are joined, 9–15 are waitlisted.
    // Parallel joins are non-deterministic due to pg_advisory_xact_lock ordering,
    // which would make later assertions about specific users unreliable.
    for (let i = 1; i <= 15; i++) {
      await joinAs(browser, i, sessionUrl)
    }

    // ── Verify counts: 8 joined, 7 waitlist ──────────────────────────────
    const verifyCtx = await browser.newContext({ storageState: authAs(1) })
    const verifyPage = await verifyCtx.newPage()
    await verifyPage.goto(sessionUrl)
    await expect(verifyPage.locator('text=已报名（8/8）')).toBeVisible({ timeout: 5_000 })
    await expect(verifyPage.getByText('— 候补 —')).toBeVisible()
    // 7 waitlist rows — siblings immediately after the 候补 divider
    const waitlistRows = verifyPage.locator('xpath=//div[normalize-space()="— 候补 —"]/following-sibling::div')
    await expect(waitlistRows).toHaveCount(7, { timeout: 5_000 })
    await verifyCtx.close()

    // ── Users 1, 2, 3 withdraw ────────────────────────────────────────────
    for (let i = 1; i <= 3; i++) {
      await withdrawAs(browser, i, sessionUrl)
    }

    // ── Verify final state: 8 joined, 4 waitlist ─────────────────────────
    const finalCtx  = await browser.newContext({ storageState: authAs(4) })
    const finalPage = await finalCtx.newPage()
    await finalPage.goto(sessionUrl)
    // Reload once to get a stable server snapshot — avoids catching a
    // mid-promotion realtime event that transiently inflates the waitlist count
    await finalPage.reload()
    await expect(finalPage.locator('text=已报名（8/8）')).toBeVisible({ timeout: 8_000 })
    await expect(finalPage.getByText('— 候补 —')).toBeVisible()
    const finalWaitlist = finalPage.locator('xpath=//div[normalize-space()="— 候补 —"]/following-sibling::div')
    await expect(finalWaitlist).toHaveCount(4, { timeout: 5_000 })
    await finalCtx.close()

    // ── Lock session as user 1 (admin / creator) ──────────────────────────
    // Sequential joins → users 1–8 originally joined, 9–15 waitlisted.
    // After users 1–3 withdraw: DB promotes 9, 10, 11 → joined = {4–11}, waitlist = {12–15}.
    const adminCtx  = await browser.newContext({ storageState: authAs(1) })
    const adminPage = await adminCtx.newPage()
    await adminPage.goto(sessionUrl)
    await adminPage.locator('button', { hasText: '🔒 锁定接龙' }).click()
    await adminPage.locator('button', { hasText: '确定' }).click()   // confirm 锁定 dialog
    await expect(adminPage.getByText('已锁定')).toBeVisible({ timeout: 5_000 })

    // ── Admin marks first 4 participants as +时 ───────────────────────────
    // Only admin sees +时 buttons; click the first 4 of the 8 joined rows
    const lateButtons = adminPage.locator('button', { hasText: '+时' })
    await expect(lateButtons).toHaveCount(8, { timeout: 5_000 })
    for (let i = 0; i < 4; i++) {
      await lateButtons.nth(i).click()
      await adminPage.locator('button', { hasText: '确定' }).click()   // confirm 加时 dialog
      await expect(lateButtons.nth(i)).toHaveClass(/orange/, { timeout: 3_000 })
    }
    await adminCtx.close()

    // ── Users 4, 5, 6, 7, 8, 9 mark as paid (parallel) ──────────────────
    // Payment is self-service: each user toggles their own row
    await Promise.all([4, 5, 6, 7, 8, 9].map(i => markPaidAs(browser, i, sessionUrl)))

    // ── Validate +时名单 has exactly 4 entries ────────────────────────────
    const checkCtx  = await browser.newContext({ storageState: authAs(4) })
    const checkPage = await checkCtx.newPage()
    await checkPage.goto(sessionUrl)
    // Reload for a stable server snapshot (same reason as finalPage above)
    await checkPage.reload()

    // ── Validate +时名单 has exactly 4 entries ────────────────────────────
    await expect(checkPage.getByText('+时名单')).toBeVisible({ timeout: 5_000 })
    const lateRows = checkPage.locator('xpath=//h2[contains(., "+时名单")]/following-sibling::div')
    await expect(lateRows).toHaveCount(4, { timeout: 5_000 })

    // ── Validate 6 of the 8 joined are marked paid ───────────────────────
    // Per-row paid status of *other* users is admin-only; the aggregate
    // counter is visible to everyone, so assert that instead. The 6 payments
    // are committed in parallel, so reload-and-recheck until they all land
    // (a single snapshot can race a not-yet-propagated write).
    await expect(async () => {
      await checkPage.reload()
      await expect(checkPage.getByText('已付款（6/8）')).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })

    await checkCtx.close()
  })
})
