import { APIRequestContext, APIResponse, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { config } from './config';

export interface Tokens { idToken: string; accessToken?: string }
export interface Participant { id: string | null; type: 'Owner' | 'Guest'; name: string; items: Array<{ dish: { id: string; name: string; price: number }; quantity: number }>; total: number; isSubmitted: boolean }
export interface GroupView { participants: Participant[]; total: number }

/** Thin client over the public API. Methods return the raw response, so tests can assert negatives. */
export class Api {
  constructor(private readonly http: APIRequestContext) {}

  private call(method: string, path: string, token?: string, data?: unknown): Promise<APIResponse> {
    return this.http.fetch(config.apiUrl + path, {
      method,
      data,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      failOnStatusCode: false,
    });
  }

  register(email: string, password: string, firstName = 'Aqa', lastName = 'Tester') {
    return this.call('POST', '/register', undefined, { firstName, lastName, email, password, confirmPassword: password });
  }
  signIn(email: string, password: string) { return this.call('POST', '/signin', undefined, { email, password }); }
  me(token: string) { return this.call('GET', '/me', token); }

  createReservation(token: string, tableId: string, guestCount: number, start: Date, end: Date) {
    return this.call('POST', '/reservations', token, { tableId, guestCount, startTime: start.toISOString(), endTime: end.toISOString() });
  }
  inviteToken(token: string, reservationId: string) { return this.call('GET', `/reservations/${reservationId}/invite-token`, token); }
  invite(inviteToken: string) { return this.call('GET', `/guest/invites/${inviteToken}`); }
  createOrder(token: string, reservationId: string, orderItems: Array<{ dishId: string; quantity: number }>) {
    return this.call('POST', '/orders', token, { reservationId, orderItems });
  }
  order(token: string, reservationId: string) { return this.call('GET', `/orders/${reservationId}`, token); }

  join(groupReservationId: string, guestName: string) { return this.call('POST', '/guest/sessions', undefined, { groupReservationId, guestName }); }
  addDish(sessionToken: string, sessionId: string, dishId: string, quantity: number) {
    return this.call('POST', `/guest/sessions/${sessionId}/dishes`, sessionToken, { dishId, quantity });
  }
  submitCart(sessionToken: string, sessionId: string) { return this.call('POST', `/guest/sessions/${sessionId}/submit`, sessionToken); }

  groupSessions(groupId: string, token?: string) { return this.call('GET', `/guest/groups/${groupId}/sessions`, token); }
  removeSession(groupId: string, sessionId: string, token?: string) { return this.call('DELETE', `/guest/groups/${groupId}/sessions/${sessionId}`, token); }
  submitGroup(groupId: string, reservationId: string, token?: string) {
    return this.call('POST', `/group-reservations/${groupId}/submit`, token, { reservationId });
  }
}

export const newCredentials = () => {
  const run = randomBytes(5).toString('hex');
  return { email: `aqa-${run}@example.com`, password: `Aq-${run}!` };
};

/** Secondary indexes are eventually consistent: retries a read until it satisfies `ready`. */
export async function eventually<T>(read: () => Promise<APIResponse>, ready: (body: T) => boolean = () => true, timeout = 20_000): Promise<T> {
  let body: T | undefined;
  await expect.poll(async () => {
    const response = await read();
    if (!response.ok()) return false;
    body = (await response.json()) as T;
    return ready(body);
  }, { timeout, intervals: [500, 1000, 2000] }).toBe(true);
  return body as T;
}
