import { Browser, BrowserContext, expect, Locator, Page } from '@playwright/test';
import { User } from './fixtures';

/** Opens a browser context signed in as `user`, the way the app stores a session after login. */
export async function signedIn(page: Page | BrowserContext, user: User, profile: unknown) {
  await page.addInitScript(([auth, me]) => {
    localStorage.setItem('auth', auth);
    localStorage.setItem('user', me);
  }, [JSON.stringify(user.tokens), JSON.stringify(profile)] as const);
}

export class GroupOrderPage {
  constructor(private readonly page: Page) {}

  goto(reservationId: string) { return this.page.goto(`/reservations/${reservationId}/group-order`); }

  card(title: string): Locator { return this.page.locator('app-participant-card').filter({ has: this.page.getByRole('heading', { name: title, exact: true }) }); }
  guest(name: string) { return this.card(`Guest: ${name}`); }
  get grandTotal() { return this.page.locator('main, body').getByText('Grand Total').locator('..'); }
  get submitButton() { return this.page.getByRole('button', { name: 'Submit Pre-Order' }); }
  refresh() { return this.page.getByRole('button', { name: 'Refresh' }).click(); }

  async expectDish(card: Locator, dish: string, quantity: number, sum: string) {
    const row = card.locator('li').filter({ hasText: dish });
    await expect(row).toContainText(`× ${quantity}`);
    await expect(row).toContainText(sum);
  }

  async removeGuest(name: string) {
    await this.page.getByRole('button', { name: `Remove ${name}`, exact: true }).click();
    await this.page.getByRole('dialog').getByRole('button', { name: 'Remove Guest' }).click();
    await expect(this.guest(name)).toHaveCount(0);
  }

  async submit() {
    await this.submitButton.click();
    await this.page.getByRole('dialog').getByRole('button', { name: 'Submit', exact: true }).click();
  }
}

export class WaiterPage {
  constructor(private readonly page: Page) {}

  goto() { return this.page.goto('/waiter-reservations'); }
  card(tableNumber: number) { return this.page.locator('app-card-reservation').filter({ hasText: String(tableNumber) }); }

  async openPreOrder(tableNumber: number) {
    await this.card(tableNumber).getByRole('button', { name: 'Pre-order' }).or(this.card(tableNumber).getByText('Pre-order', { exact: true }).last()).first().click();
    await expect(this.page).toHaveURL(/waiter-pre-order/);
  }
  dish(name: string) { return this.page.locator('app-dish-card').filter({ hasText: name }); }
}

export async function waiterContext(browser: Browser, baseURL: string, user: User, profile: unknown) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  await signedIn(context, user, profile);
  return context;
}
