import { expect, test } from '../../src/fixtures';

test.describe('Level 3: owner removes a participant', { tag: ['@L3', '@api'] }, () => {
  test('removing one of several keeps the rest and recalculates the total', async ({ newGroup, restaurant: r, api }) => {
    const group = await newGroup();
    const leaving = await (await group.join('Leaving')).add(r.soup, 2);
    await (await group.join('Staying')).add(r.salad, 1);
    await group.waitForGuest('Leaving', (p) => p.items.length === 1);
    await group.waitForGuest('Staying', (p) => p.items.length === 1);

    expect((await api.removeSession(group.groupId, leaving.id, group.owner.token)).status()).toBe(200);

    const view = await group.waitForGuests('Staying');
    expect(view.total).toBe(r.salad.price);
  });

  test('a removed submitted participant does not reach the order', async ({ newGroup, restaurant: r, api, seed }) => {
    const group = await newGroup();
    await group.createOrder([{ dish: r.tea, quantity: 1 }]);
    const leaving = await (await (await group.join('Leaving')).add(r.soup, 2)).submit();
    await (await (await group.join('Staying')).add(r.salad, 1)).submit();
    await group.waitForGuest('Leaving', (p) => p.isSubmitted);
    await group.waitForGuest('Staying', (p) => p.isSubmitted);

    expect((await api.removeSession(group.groupId, leaving.id, group.owner.token)).status()).toBe(200);
    await group.waitForGuests('Staying');
    expect((await api.submitGroup(group.groupId, group.reservationId, group.owner.token)).status()).toBe(200);

    const [order] = await seed.find('Orders', 'reservationId', group.reservationId);
    expect(order.dishes.map((d: any) => d.dishId).sort()).toEqual([r.tea.id, r.salad.id].sort());
  });

  test('removing the last participant leaves an empty group', async ({ newGroup, restaurant: r, api }) => {
    const group = await newGroup();
    const guest = await (await group.join('Last')).add(r.soup, 1);
    await group.waitForGuests('Last');
    expect((await api.removeSession(group.groupId, guest.id, group.owner.token)).status()).toBe(200);
    const view = await group.waitForGuests();
    expect(view.total).toBe(0);
    expect(view.participants).toEqual([]);
  });

  test('a participant of another group gets 400', async ({ newGroup, api }) => {
    const [mine, other] = [await newGroup(), await newGroup()];
    const foreign = await other.join('Foreign');
    await other.waitForGuests('Foreign');
    expect((await api.removeSession(mine.groupId, foreign.id, mine.owner.token)).status()).toBe(400);
  });

  test('a nonexistent participant gets 404', async ({ newGroup, api }) => {
    const group = await newGroup();
    expect((await api.removeSession(group.groupId, 'aqa-no-such-session', group.owner.token)).status()).toBe(404);
  });

  test('another client gets 403 and the participant stays', async ({ newGroup, users, api }) => {
    const group = await newGroup();
    const guest = await group.join('Andrii');
    await group.waitForGuests('Andrii');
    expect((await api.removeSession(group.groupId, guest.id, (await users.create()).token)).status()).toBe(403);
    await group.waitForGuests('Andrii');
  });

  test('an unauthorized request gets 401', async ({ newGroup, api }) => {
    const group = await newGroup();
    const guest = await group.join('Andrii');
    expect((await api.removeSession(group.groupId, guest.id)).status()).toBe(401);
  });
});
