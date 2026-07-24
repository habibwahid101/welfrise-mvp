import { expect, test } from '@playwright/test'

test('public home opens', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toBeVisible()
})

test('login opens and password visibility is accessible', async ({ page }) => {
  await page.goto('/login')
  const password = page.locator('#password')
  await password.fill('disposable-password')
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await expect(page.getByRole('button', { name: 'Hide password' })).toBeFocused()
})

test('registration form preserves fields and supports password visibility', async ({ page }) => {
  await page.goto('/register')
  await page.locator('#name').fill('Disposable Tester')
  await page.locator('#email').fill('disposable@example.invalid')
  await page.locator('#password').fill('not-a-real-secret')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(page.locator('#name')).toHaveValue('Disposable Tester')
  await expect(page.locator('#password')).toHaveAttribute('type', 'text')
})

test('prototype redirects to dashboard path', async ({ page }) => {
  const paths: string[] = []
  page.on('request',request => paths.push(new URL(request.url()).pathname))
  await page.goto('https://welfrise-mvp.vercel.app/app/prototype')
  expect(paths).toContain('/app')
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
})

test('unauthenticated production app redirects to login', async ({ page }) => {
  await page.goto('https://welfrise-mvp.vercel.app/app')
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
})

test('mobile auth pages have no unintended horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  for (const route of ['/login', '/register', '/reset-password']) {
    await page.goto(route)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow, route).toBe(false)
  }
})

test('recovery errors are announced through an accessible live region', async ({ page }) => {
  await page.goto('/reset-password')
  await expect(page.locator('.notice[role="alert"]')).toBeVisible()
})
