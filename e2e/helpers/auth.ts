import { type Page } from "@playwright/test"

type RegisterAndLoginOptions = {
  emailPrefix?: string
  name?: string
  nicknamePrefix?: string
}

export async function registerAndLogin(
  page: Page,
  options: RegisterAndLoginOptions = {}
): Promise<{ stamp: string; email: string; password: string }> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const emailPrefix = options.emailPrefix || "e2e-user"
  const name = options.name || "E2E User"
  const nicknamePrefix = options.nicknamePrefix || "e2e"
  const nickname = `${nicknamePrefix}-${stamp.slice(-6)}`
  const email = `${emailPrefix}-${stamp}@example.com`
  const password = "Passw0rd!123"

  await page.goto("/register")
  await page.locator("#name").fill(name)
  await page.locator("#nickname").fill(nickname)
  await page.locator("#email").fill(email)
  await page.locator("#password").fill(password)
  await page.getByRole("button", { name: /create account/i }).click()

  const redirectedAfterRegister = await page
    .waitForURL(/\/(dashboard|login)/, { timeout: 30000 })
    .then(() => true)
    .catch(() => false)

  if (!redirectedAfterRegister) {
    const registrationError = page.getByText("Registration failed")
    if (await registrationError.isVisible().catch(() => false)) {
      throw new Error("Registration failed during e2e setup")
    }
    await page.goto("/login?registered=true")
  }

  if (!page.url().includes("/dashboard")) {
    await page.goto("/login")
    await page.locator("#email").fill(email)
    await page.locator("#password").fill(password)
    await page.getByRole("button", { name: /^sign in$/i }).click()
    await page.waitForURL(/\/dashboard/, { timeout: 20000 })
  }

  return { stamp, email, password }
}
