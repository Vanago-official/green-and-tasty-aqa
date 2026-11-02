import { expect, test } from '../../src/fixtures';
import { newCredentials } from '../../src/api';

test('sign-in of an unknown user gets 401', { tag: ['@L1', '@api'] }, async ({ api }) => {
  const { email, password } = newCredentials();
  expect((await api.signIn(email, password)).status()).toBe(401);
});
