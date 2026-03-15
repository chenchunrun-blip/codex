import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('should display login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h2')).toContainText('Sign in to your account');
    await expect(page.getByRole('link', { name: /create a new account/i })).toBeVisible();
  });

  test('should display registration page', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('h2')).toContainText('Create your account');
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
  });

  test('should redirect to login when accessing protected routes', async ({ page }) => {
    const protectedRoutes = ['/dashboard', '/tasks', '/agents', '/reports', '/projects', '/teams', '/files', '/templates'];
    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
    }
  });
});

test.describe('Application Structure', () => {
  test('should have all main pages accessible', async ({ page }) => {
    const pages = ['/login', '/register'];

    for (const pagePath of pages) {
      await page.goto(pagePath);
      await expect(page).toHaveURL(pagePath);
    }
  });
});
