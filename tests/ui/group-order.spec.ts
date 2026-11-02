import { expect, test } from '../../src/fixtures';
import { GroupOrderPage, signedIn, waiterContext, WaiterPage } from '../../src/pages';

test.describe('Level 1: owner page', { tag: ['@L1', '@ui'] }, () => {
  test('owner sees participants, dishes, sums, marks and the total', async ({ page, newGroup, restaurant: r, api }) => {
    const group = await newGroup();
    await (await (await (await group.join('Andrii')).add(r.salad, 2)).add(r.soup, 1)).submit();
    await (await group.join('Olena')).add(r.soup, 1);
    await group.join('Empty');
    await group.waitForGuest('Andrii', (p) => p.isSubmitted);
    await group.waitForGuest('Olena', (p) => p.items.length === 1);
    await group.waitForGuests('Andrii', 'Olena', 'Empty');

    await signedIn(page, group.owner, await (await api.me(group.owner.token)).json());
    const owner = new GroupOrderPage(page);
    await owner.goto(group.reservationId);

    await owner.expectDish(owner.guest('Andrii'), r.salad.name, 2, '$24.00');
    await owner.expectDish(owner.guest('Andrii'), r.soup.name, 1, '$20.00');
    await expect(owner.guest('Andrii')).toContainText('Submitted');
    await expect(owner.guest('Olena')).toContainText('Still choosing');
    await expect(owner.guest('Empty')).toContainText('No dishes yet');
    await expect(owner.grandTotal).toContainText('$44.00');
  });

  test('another client cannot see the group', async ({ page, newGroup, users, api }) => {
    const group = await newGroup();
    await group.join('Andrii');
    const stranger = await users.create();
    await signedIn(page, stranger, await (await api.me(stranger.token)).json());
    await new GroupOrderPage(page).goto(group.reservationId);
    await expect(page.getByText('Grand Total')).toHaveCount(0);
    await expect(page.getByText('Guest: Andrii')).toHaveCount(0);
  });

  test('an unauthorized visitor does not see the group', async ({ page, newGroup }) => {
    const group = await newGroup();
    await group.join('Andrii');
    await new GroupOrderPage(page).goto(group.reservationId);
    await expect(page.getByText('Grand Total')).toHaveCount(0);
    await expect(page.getByText('Guest: Andrii')).toHaveCount(0);
  });

  test('a nonexistent group shows not found', async ({ page, users, api }) => {
    const user = await users.create();
    await signedIn(page, user, await (await api.me(user.token)).json());
    await new GroupOrderPage(page).goto('aqa-no-such-reservation');
    await expect(page.getByText('Group reservation not found')).toBeVisible();
  });
});

test.describe('Level 2: submit and the waiter', { tag: ['@L2', '@ui'] }, () => {
  test('owner confirms the pre-order and the waiter sees it', async ({ page, browser, baseURL, newGroup, restaurant: r, api }) => {
    const group = await newGroup();
    await group.createOrder([{ dish: r.tea, quantity: 1 }]);
    await (await (await group.join('Andrii')).add(r.salad, 2)).submit();
    await (await group.join('Chooser')).add(r.soup, 5);
    await group.waitForGuest('Andrii', (p) => p.isSubmitted);
    await group.waitForGuest('Chooser', (p) => p.items.length === 1);

    await signedIn(page, group.owner, await (await api.me(group.owner.token)).json());
    const owner = new GroupOrderPage(page);
    await owner.goto(group.reservationId);
    await owner.submit();
    await expect(page.getByText('Sent to Restaurant')).toBeVisible();
    await expect(owner.submitButton).toHaveCount(0);

    const context = await waiterContext(browser, baseURL!, r.waiter, await (await api.me(r.waiter.token)).json());
    const waiterTab = await context.newPage();
    const waiter = new WaiterPage(waiterTab);
    await waiter.goto();
    await expect(waiter.card(group.tableNumber)).toContainText('Pre-order: 2 dishes');
    await waiter.openPreOrder(group.tableNumber);
    await expect(waiter.dish(r.salad.name)).toContainText('Quantity: 2');
    await expect(waiter.dish(r.tea.name)).toContainText('Quantity: 1');
    await expect(waiter.dish(r.soup.name)).toHaveCount(0);
    await context.close();
  });

  test('with nothing submitted the owner cannot confirm', async ({ page, newGroup, restaurant: r, api }) => {
    const group = await newGroup();
    await group.createOrder();
    await (await group.join('Chooser')).add(r.salad, 1);
    await group.waitForGuest('Chooser', (p) => p.items.length === 1);
    await signedIn(page, group.owner, await (await api.me(group.owner.token)).json());
    const owner = new GroupOrderPage(page);
    await owner.goto(group.reservationId);
    await expect(owner.guest('Chooser')).toBeVisible();
    await expect(owner.submitButton).toBeDisabled();
    await expect(owner.grandTotal).toContainText('$0.00');
  });

  test('known defect: the page still opens after submit', { tag: '@known-defect' }, async ({ page, newGroup, restaurant: r, api }) => {
    test.fail(true, 'Reload after submit shows "Group reservation was submitted." instead of the read-only page');
    const group = await newGroup();
    await group.createOrder();
    await (await (await group.join('Andrii')).add(r.salad, 1)).submit();
    await group.waitForGuest('Andrii', (p) => p.isSubmitted);
    expect((await api.submitGroup(group.groupId, group.reservationId, group.owner.token)).status()).toBe(200);
    await signedIn(page, group.owner, await (await api.me(group.owner.token)).json());
    await new GroupOrderPage(page).goto(group.reservationId);
    await expect(page.getByText('Sent to Restaurant')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Level 3: removing participants', { tag: ['@L3', '@ui'] }, () => {
  test('E2E: guests add, owner reviews, removes one, submits, waiter sees the rest', async ({ page, browser, baseURL, newGroup, restaurant: r, api }) => {
    const group = await newGroup();
    await group.createOrder([{ dish: r.tea, quantity: 1 }]);
    await (await (await group.join('Staying')).add(r.salad, 1)).submit();
    await (await (await group.join('Leaving')).add(r.soup, 2)).submit();
    await group.waitForGuest('Staying', (p) => p.isSubmitted);
    await group.waitForGuest('Leaving', (p) => p.isSubmitted);

    await signedIn(page, group.owner, await (await api.me(group.owner.token)).json());
    const owner = new GroupOrderPage(page);
    await owner.goto(group.reservationId);
    await expect(owner.grandTotal).toContainText('$52.00');

    await owner.removeGuest('Leaving');
    await expect(owner.grandTotal).toContainText('$12.00');
    await owner.submit();
    await expect(page.getByText('Sent to Restaurant')).toBeVisible();

    const context = await waiterContext(browser, baseURL!, r.waiter, await (await api.me(r.waiter.token)).json());
    const waiterTab = await context.newPage();
    const waiter = new WaiterPage(waiterTab);
    await waiter.goto();
    await waiter.openPreOrder(group.tableNumber);
    await expect(waiter.dish(r.salad.name)).toContainText('Quantity: 1');
    await expect(waiter.dish(r.soup.name)).toHaveCount(0);
    await context.close();
  });
});
