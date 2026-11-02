import { APIRequestContext, test as base } from '@playwright/test';
import { Api, eventually, GroupView, newCredentials, Tokens } from './api';
import { Seed, uid } from './seed';

export interface User { email: string; id: string; tokens: Tokens; token: string }
export interface Dish { id: string; name: string; price: number }

/** Reference data of one worker: a location with its menu and its only waiter. */
export interface Restaurant { locationId: string; address: string; tea: Dish; salad: Dish; soup: Dish; waiter: User }

export class Guest {
  constructor(private readonly api: Api, readonly name: string, readonly id: string, readonly token: string) {}
  async add(dish: Dish, quantity: number) {
    const response = await this.api.addDish(this.token, this.id, dish.id, quantity);
    if (!response.ok()) throw new Error(`add dish: ${response.status()} ${await response.text()}`);
    return this;
  }
  async submit() {
    const response = await this.api.submitCart(this.token, this.id);
    if (!response.ok()) throw new Error(`submit cart: ${response.status()} ${await response.text()}`);
    return this;
  }
}

/** One reservation with its group, created through the API as the owner would. */
export class Group {
  constructor(
    private readonly api: Api,
    readonly owner: User,
    readonly reservationId: string,
    readonly groupId: string,
    readonly tableNumber: number,
    readonly restaurant: Restaurant,
  ) {}

  async join(name: string) {
    const response = await this.api.join(this.groupId, name);
    if (!response.ok()) throw new Error(`join: ${response.status()} ${await response.text()}`);
    const session = await response.json();
    return new Guest(this.api, name, session.SessionId, session.SessionToken);
  }

  /** The owner's own pre-order: the order the group's submit merges into. */
  async createOrder(items = [{ dish: this.restaurant.tea, quantity: 1 }]) {
    const response = await this.api.createOrder(this.owner.token, this.reservationId, items.map((i) => ({ dishId: i.dish.id, quantity: i.quantity })));
    if (!response.ok()) throw new Error(`create order: ${response.status()} ${await response.text()}`);
    await eventually(() => this.api.order(this.owner.token, this.reservationId));
  }

  view() { return eventually<GroupView>(() => this.api.groupSessions(this.groupId, this.owner.token)); }

  /** Waits until the group's guest list has settled on the expected guests. */
  waitForGuests(...names: string[]) {
    const expected = [...names].sort().join();
    return eventually<GroupView>(
      () => this.api.groupSessions(this.groupId, this.owner.token),
      (v) => v.participants.filter((p) => p.type === 'Guest').map((p) => p.name).sort().join() === expected,
    );
  }

  /** Waits until a guest's cart is visible to the owner. */
  waitForGuest(name: string, check: (p: GroupView['participants'][number]) => boolean) {
    return eventually<GroupView>(
      () => this.api.groupSessions(this.groupId, this.owner.token),
      (v) => { const p = v.participants.find((x) => x.name === name); return !!p && check(p); },
    );
  }
}

interface Fixtures { seed: Seed; users: { create(): Promise<User> }; newGroup: () => Promise<Group>; api: Api }
interface WorkerFixtures { http: APIRequestContext; workerSeed: Seed; restaurant: Restaurant }

async function registerUser(api: Api, seed: Seed): Promise<User> {
  const { email, password } = newCredentials();
  const registered = await api.register(email, password);
  if (!registered.ok()) throw new Error(`register: ${registered.status()} ${await registered.text()}`);
  seed.trackUser(email);
  const tokens: Tokens = await (await api.signIn(email, password)).json();
  const me = await (await api.me(tokens.idToken)).json();
  return { email, id: me.id, tokens, token: tokens.idToken };
}

const dishItem = (locationId: string, id: string, name: string, price: number) => ({
  id, name, price, locationId, state: 1, dishType: 0, description: 'AQA test dish',
  weight: '100', calories: '1', proteins: '1', fats: '1', carbohydrates: '1', vitamins: '1',
});

export const test = base.extend<Fixtures, WorkerFixtures>({
  http: [async ({ playwright }, use) => {
    const http = await playwright.request.newContext();
    await use(http);
    await http.dispose();
  }, { scope: 'worker' }],

  workerSeed: [async ({}, use) => {
    const seed = new Seed();
    await use(seed);
    await seed.dispose();
  }, { scope: 'worker' }],

  restaurant: [async ({ http, workerSeed: seed }, use) => {
    const api = new Api(http);
    const locationId = uid('loc');
    const address = `${locationId} Test Avenue`;
    await seed.put('Locations', { id: locationId, address }, { id: locationId });
    const dish = async (name: string, price: number): Promise<Dish> => {
      const id = uid('dish');
      await seed.put('Dishes', dishItem(locationId, id, name, price), { id });
      return { id, name, price };
    };
    const [tea, salad, soup] = [await dish('AQA Tea', 3), await dish('AQA Salad', 12), await dish('AQA Soup', 20)];
    const account = newCredentials();
    const registered = await api.register(account.email, account.password, 'Aqa', 'Waiter');
    if (!registered.ok()) throw new Error(`register waiter: ${registered.status()}`);
    seed.trackUser(account.email);
    const first = await (await api.signIn(account.email, account.password)).json();
    const { id } = await (await api.me(first.idToken)).json();
    await seed.makeWaiter(account.email, id, locationId);
    // Sign in again: the Waiter group only appears in a fresh token.
    const tokens = await (await api.signIn(account.email, account.password)).json();
    await use({ locationId, address, tea, salad, soup, waiter: { email: account.email, id, tokens, token: tokens.idToken } });
    await seed.removeWhere('Notifications', 'userId', id, (n) => ({ id: n.id }));
  }, { scope: 'worker' }],

  api: async ({ http }, use) => { await use(new Api(http)); },

  seed: async ({}, use) => {
    const seed = new Seed();
    await use(seed);
    await seed.dispose();
  },

  users: async ({ api, seed }, use) => { await use({ create: () => registerUser(api, seed) }); },

  newGroup: async ({ api, seed, restaurant }, use) => {
    const groups: Array<{ groupReservationId: string; reservationId: string }> = [];
    await use(async () => {
      const owner = await registerUser(api, seed);
      const tableId = uid('tbl');
      const tableNumber = 1000 + Math.floor(Math.random() * 9000);
      await seed.put('Tables', { id: tableId, locationId: restaurant.locationId, capacity: 10, tableNumber }, { id: tableId });
      // Always in the future, whenever the suite runs.
      const start = new Date(Date.now() + 3 * 24 * 3_600_000);
      const end = new Date(start.getTime() + 3_600_000);
      const created = await api.createReservation(owner.token, tableId, 8, start, end);
      if (!created.ok()) throw new Error(`create reservation: ${created.status()} ${await created.text()}`);
      const reservationId = (await created.json()).id;
      seed.trackItem('Reservations', { id: reservationId });
      const tokenBody = await eventually<any>(() => api.inviteToken(owner.token, reservationId));
      const inviteToken: string = tokenBody.Token ?? tokenBody.token;
      const invite = await eventually<any>(() => api.invite(inviteToken));
      const groupReservationId: string = invite.GroupReservationId;
      seed.trackItem('GroupReservations', { groupReservationId });
      groups.push({ groupReservationId, reservationId });
      return new Group(api, owner, reservationId, groupReservationId, tableNumber, restaurant);
    });
    for (const { groupReservationId, reservationId } of groups) {
      await seed.removeWhere('GuestSessions', 'groupReservationId', groupReservationId, (i) => ({ guestSessionId: i.guestSessionId }));
      await seed.removeWhere('Orders', 'reservationId', reservationId, (i) => ({ orderId: i.orderId, customerId: i.customerId }));
    }
  },
});

export { expect } from '@playwright/test';
