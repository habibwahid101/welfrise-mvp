import { expect, test } from '@playwright/test'

async function openRecovery(page: import('@playwright/test').Page, email='member@example.test') {
  await page.goto('/login')
  await page.locator('#email').fill(email)
  await page.getByRole('button',{name:'Forgot password?'}).click()
  await expect(page.locator('#recovery-email')).toHaveValue(email)
}

test('Forgot Password opens in place, prefills email, and keeps keyboard focus visible', async ({ page }) => {
  await openRecovery(page)
  await expect(page.getByRole('heading',{name:'Reset your password'})).toBeVisible()
  await page.locator('#recovery-email').focus()
  const outline = await page.locator('#recovery-email').evaluate((element) => getComputedStyle(element).boxShadow)
  expect(outline).not.toBe('none')
})

test('recovery submission prevents duplicate requests and shows neutral success', async ({ page }) => {
  let requests=0
  await page.route('**/api/auth/password-recovery/request',async (route) => {
    requests += 1
    await new Promise((resolve) => setTimeout(resolve,150))
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,message:'If an account exists for this email, a password-reset link has been sent.'})})
  })
  await openRecovery(page)
  await page.locator('form.recovery-request').evaluate((form) => {
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
  })
  await expect(page.getByRole('status')).toContainText('If an account exists')
  expect(requests).toBe(1)
})

test('provider rate limit is shown as an accessible temporary error', async ({ page }) => {
  await page.route('**/api/auth/password-recovery/request',route => route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'Recovery email delivery is temporarily limited. Please wait before trying again.',correlationId:'00000000-0000-4000-8000-000000000000'})}))
  await openRecovery(page)
  await page.getByRole('button',{name:'Send recovery link'}).click()
  await expect(page.locator('.notice[role="alert"]')).toContainText('temporarily limited')
})

test('valid recovery session supports visibility, mismatch validation, update, and return to login', async ({ page }) => {
  await page.route('**/api/auth/password-recovery/session',route => route.fulfill({status:200,contentType:'application/json',body:'{"valid":true}'}))
  await page.route('**/api/auth/password-recovery/update',route => route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}))
  await page.goto('/reset-password?flow=recovery&verified=1')
  await expect(page.locator('#new-password')).toBeVisible()
  await page.locator('#new-password').fill('abcdefghijkl')
  await page.locator('#confirm-password').fill('abcdefghijkm')
  await page.getByRole('button',{name:'Update password'}).click()
  await expect(page.locator('.notice[role="alert"]')).toContainText('Passwords do not match')
  await page.getByRole('button',{name:'Show password'}).first().click()
  await expect(page.locator('#new-password')).toHaveAttribute('type','text')
  await page.locator('#confirm-password').fill('abcdefghijkl')
  await page.getByRole('button',{name:'Update password'}).click()
  await expect(page.getByRole('status')).toContainText('password has been updated')
  await expect(page.getByRole('link',{name:'Return to sign in'})).toHaveAttribute('href','/login')
})

test('invalid recovery callback remains safe and strips URL parameters', async ({ page }) => {
  await page.goto('/reset-password?error=invalid_recovery&error_description=provider-secret&reference=safe-reference')
  await expect(page.locator('.notice[role="alert"]')).toContainText('invalid, expired, or has already been used')
  await expect(page).toHaveURL(/\/reset-password$/)
  await expect(page.locator('body')).not.toContainText('provider-secret')
})

test('recovery flow has no horizontal overflow at mobile width', async ({ page }) => {
  await page.setViewportSize({width:375,height:812})
  await openRecovery(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
})
