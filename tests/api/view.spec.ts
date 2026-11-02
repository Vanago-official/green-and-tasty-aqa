import { expect, test } from '../../src/fixtures';

test.describe('Level 1: owner views the group pre-order', { tag: ['@L1', '@api'] }, () => {
  test('shows every participant with dishes, quantities and sums', async ({ newGroup, restaurant: r }) => {
    const group = await newGroup();
    await (await (await group.join('Andrii')).add(r.salad, 2)).add(r.soup, 1);
    await (await group.join('Olena')).add(r.soup, 3);
    await group.waitForGuest('Andrii', (p) => p.items.length === 2);
    const view = await group.waitForGuest('Olena', (p) => p.items.length === 1);

    const andrii = view.participants.find((p) => p.name === 'Andrii')!;
    expect(andrii.total).toBe(2 * r.salad.price + r.soup.price);
    expect(andrii.items.map((i) => [i.dish.name, i.quantity]).sort()).toEqual([[r.salad.name, 2], [r.soup.name, 1]]);
    expect(view.participants.find((p) => p.name === 'Olena')!.total).toBe(3 * r.soup.price);
  });

  test('grand total is the sum of participants and follows a cart change', async ({ newGroup, restaurant: r }) => {
    const group = await newGroup();
    const guest = await (await group.join('Andrii')).add(r.salad, 1);
    await (await group.join('Olena')).add(r.soup, 1);
    await group.waitForGuest('Olena', (p) => p.total === r.soup.price);
    const before = await group.waitForGuest('Andrii', (p) => p.total === r.salad.price);
    expect(before.total).toBe(before.participants.reduce((sum, p) => sum + p.total, 0));

    await guest.add(r.soup, 2);
    const after = await group.waitForGuest('Andrii', (p) => p.total === r.salad.price + 2 * r.soup.price);
    expect(after.total).toBe(before.total + 2 * r.soup.price);
  });

  test('marks an unsubmitted participant and lists one without dishes', async ({ newGroup, restaurant: r }) => {
    const group = await newGroup();
    await (await (await group.join('Submitter')).add(r.salad, 1)).submit();
    await (await group.join('Chooser')).add(r.salad, 1);
    await group.join('Empty');
    await group.waitForGuest('Submitter', (p) => p.isSubmitted);
    await group.waitForGuests('Submitter', 'Chooser', 'Empty');
    const fresh = await group.view();
    expect(fresh.participants.find((p) => p.name === 'Chooser')!.isSubmitted).toBe(false);
    const empty = fresh.participants.find((p) => p.name === 'Empty')!;
    expect(empty.items).toEqual([]);
    expect(empty.total).toBe(0);
  });

  test('a group nobody joined has no participants and zero total', async ({ newGroup }) => {
    const group = await newGroup();
    expect(await group.view()).toEqual({ participants: [], total: 0 });
  });

  test('owner group details: 200 for the owner, 403 for others, 401 unauthorized', async ({ newGroup, users, api }) => {
    const group = await newGroup();
    const owner = await api.ownerGroup(group.owner.token, group.reservationId);
    expect(owner.status()).toBe(200);
    expect((await owner.json()).GroupReservationId).toBe(group.groupId);
    expect((await api.ownerGroup((await users.create()).token, group.reservationId)).status()).toBe(403);
    expect((await api.ownerGroup(undefined, group.reservationId)).status()).toBe(401);
  });

  test('another client gets 403', async ({ newGroup, users, api }) => {
    const group = await newGroup();
    expect((await api.groupSessions(group.groupId, (await users.create()).token)).status()).toBe(403);
  });

  test('a guest of the group gets 401', async ({ newGroup, api }) => {
    const group = await newGroup();
    const guest = await group.join('Andrii');
    expect((await api.groupSessions(group.groupId, guest.token)).status()).toBe(401);
  });

  test('the waiter gets 403', async ({ newGroup, restaurant: r, api }) => {
    const group = await newGroup();
    expect((await api.groupSessions(group.groupId, r.waiter.token)).status()).toBe(403);
  });

  test('an unauthorized request gets 401', async ({ newGroup, api }) => {
    const group = await newGroup();
    expect((await api.groupSessions(group.groupId)).status()).toBe(401);
  });

  test('a nonexistent group gets 404', async ({ users, api }) => {
    expect((await api.groupSessions('aqa-no-such-group', (await users.create()).token)).status()).toBe(404);
  });
});
