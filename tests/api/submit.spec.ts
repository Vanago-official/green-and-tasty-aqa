import { APIResponse } from '@playwright/test';
import { expect, test } from '../../src/fixtures';

const expectError = async (response: APIResponse, status: number, message: string) => {
  expect(response.status()).toBe(status);
  expect(await response.text()).toContain(message);
};

test.describe('Level 2: owner submits the group pre-order', { tag: ['@L2', '@api'] }, () => {
  test('merges submitted carts, excludes unsubmitted, moves order and group on', async ({ newGroup, restaurant: r, api, seed }) => {
    const group = await newGroup();
    await group.createOrder([{ dish: r.tea, quantity: 1 }]);
    await (await (await (await group.join('Andrii')).add(r.salad, 2)).add(r.soup, 1)).submit();
    await (await (await group.join('Olena')).add(r.salad, 1)).submit();
    await (await group.join('Chooser')).add(r.soup, 50);
    await group.waitForGuest('Andrii', (p) => p.isSubmitted);
    await group.waitForGuest('Olena', (p) => p.isSubmitted);

    expect((await api.submitGroup(group.groupId, group.reservationId, group.owner.token)).status()).toBe(200);

    const [order] = await seed.find('Orders', 'reservationId', group.reservationId);
    const dishes = Object.fromEntries(order.dishes.map((d: any) => [d.dishId, d.quantity]));
    expect(dishes).toEqual({ [r.tea.id]: 1, [r.salad.id]: 3, [r.soup.id]: 1 });
    expect(order.status).toBe(3); // OrderStatus.SubmittedByCustomer
    const [stored] = await seed.find('GroupReservations', 'groupReservationId', group.groupId);
    expect(stored.status).toBe(1); // GroupReservationStatus.Submitted
  });

  test("the owner's own cart reaches the order", async ({ newGroup, restaurant: r, api, seed, users }) => {
    const group = await newGroup();
    await group.createOrder([{ dish: r.tea, quantity: 1 }]);
    expect((await api.ownerSessionToken((await users.create()).token, group.reservationId)).status()).toBe(403);
    const access = await (await api.ownerSessionToken(group.owner.token, group.reservationId)).json();
    expect((await api.addDish(access.sessionToken, access.guestSessionId, r.soup.id, 2)).status()).toBeLessThan(300);
    expect((await api.submitCart(access.sessionToken, access.guestSessionId)).status()).toBeLessThan(300);
    await group.waitForGuest(access.guestName, (p) => p.isSubmitted);
    expect((await api.submitGroup(group.groupId, group.reservationId, group.owner.token)).status()).toBe(200);
    const [order] = await seed.find('Orders', 'reservationId', group.reservationId);
    expect(order.dishes.find((d: any) => d.dishId === r.soup.id).quantity).toBe(2);
  });

  test('fails when no cart is submitted', async ({ newGroup, restaurant: r, api }) => {
    const group = await newGroup();
    await group.createOrder();
    await (await group.join('Chooser')).add(r.salad, 1);
    await group.waitForGuests('Chooser');
    await expectError(await api.submitGroup(group.groupId, group.reservationId, group.owner.token), 400, 'There are no submitted guest sessions.');
  });

  test('fails when submitted carts contain no dishes', async ({ newGroup, api, seed }) => {
    const group = await newGroup();
    await group.createOrder();
    const guest = await group.join('Empty');
    // The API refuses to submit an empty cart, so this state can only be prepared directly.
    await seed.markSubmitted(guest.id);
    await group.waitForGuest('Empty', (p) => p.isSubmitted);
    await expectError(await api.submitGroup(group.groupId, group.reservationId, group.owner.token), 400, 'Submitted guest sessions contain no dishes.');
  });

  test('fails when the reservation has no order', async ({ newGroup, restaurant: r, api }) => {
    const group = await newGroup();
    await (await (await group.join('Andrii')).add(r.salad, 1)).submit();
    await group.waitForGuest('Andrii', (p) => p.isSubmitted);
    await expectError(await api.submitGroup(group.groupId, group.reservationId, group.owner.token), 400, 'Order for this reservation was not found.');
  });

  test('fails with 404 when the reservation does not exist', async ({ newGroup, api }) => {
    const group = await newGroup();
    expect((await api.submitGroup(group.groupId, 'aqa-no-such-reservation', group.owner.token)).status()).toBe(404);
  });

  test('fails with 404 when the group does not exist', async ({ newGroup, api }) => {
    const group = await newGroup();
    expect((await api.submitGroup('aqa-no-such-group', group.reservationId, group.owner.token)).status()).toBe(404);
  });

  test('fails with 400 when the reservation belongs to another group', async ({ newGroup, api }) => {
    const [mine, other] = [await newGroup(), await newGroup()];
    await expectError(await api.submitGroup(mine.groupId, other.reservationId, mine.owner.token), 400, 'Reservation does not belong to this group reservation.');
  });

  test('a repeated submit is rejected and does not change the order', async ({ newGroup, restaurant: r, api, seed }) => {
    const group = await newGroup();
    await group.createOrder([{ dish: r.tea, quantity: 1 }]);
    await (await (await group.join('Andrii')).add(r.salad, 2)).submit();
    await group.waitForGuest('Andrii', (p) => p.isSubmitted);
    expect((await api.submitGroup(group.groupId, group.reservationId, group.owner.token)).status()).toBe(200);

    await expectError(await api.submitGroup(group.groupId, group.reservationId, group.owner.token), 400, 'Group reservation was submitted.');

    const [order] = await seed.find('Orders', 'reservationId', group.reservationId);
    expect(order.dishes.find((d: any) => d.dishId === r.salad.id).quantity).toBe(2);
  });

  test('another client gets 403', async ({ newGroup, users, api }) => {
    const group = await newGroup();
    expect((await api.submitGroup(group.groupId, group.reservationId, (await users.create()).token)).status()).toBe(403);
  });

  test('an unauthorized request gets 401', async ({ newGroup, api }) => {
    const group = await newGroup();
    expect((await api.submitGroup(group.groupId, group.reservationId)).status()).toBe(401);
  });
});
