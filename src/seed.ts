import { randomBytes } from 'node:crypto';
import { AdminAddUserToGroupCommand, AdminDeleteUserCommand, CognitoIdentityProviderClient, CreateGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DeleteItemCommand, DynamoDBClient, PutItemCommand, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { config } from './config';

export const uid = (prefix: string) => `aqa-${prefix}-${randomBytes(5).toString('hex')}`;

type Key = Record<string, string>;

/**
 * Direct access to the environment for what the public API cannot do: reference data
 * (locations, tables, dishes), promoting a user to Waiter, one impossible-by-API state,
 * and cleanup. Everything created is tracked and removed by `dispose`.
 */
export class Seed {
  private readonly db = new DynamoDBClient({ region: config.region });
  private readonly cognito = new CognitoIdentityProviderClient({ region: config.region });
  private readonly items: Array<{ table: string; key: Key }> = [];
  private readonly users: string[] = [];

  async put(table: string, item: Record<string, unknown>, key: Key) {
    this.items.push({ table, key });
    await this.db.send(new PutItemCommand({ TableName: table, Item: marshall(item) }));
  }

  trackItem(table: string, key: Key) { this.items.push({ table, key }); }
  trackUser(email: string) { this.users.push(email); }

  async markSubmitted(guestSessionId: string) {
    await this.db.send(new UpdateItemCommand({
      TableName: 'GuestSessions',
      Key: marshall({ guestSessionId }),
      UpdateExpression: 'SET isSubmitted = :v',
      ExpressionAttributeValues: { ':v': { N: '1' } },
    }));
  }

  async makeWaiter(email: string, userId: string, locationId: string) {
    await this.put('Waiters', { userId, locationId, createdAt: new Date().toISOString(), reservations: [] }, { userId });
    try {
      await this.cognito.send(new CreateGroupCommand({ UserPoolId: config.userPoolId, GroupName: 'Waiter' }));
    } catch (error) {
      if ((error as Error).name !== 'GroupExistsException') throw error;
    }
    await this.cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: config.userPoolId, GroupName: 'Waiter', Username: email }));
  }

  /** Items of `table` whose `attribute` equals `value` (the suite's tables are small). */
  async find(table: string, attribute: string, value: string): Promise<Array<Record<string, any>>> {
    const found: Array<Record<string, any>> = [];
    let start: Record<string, any> | undefined;
    do {
      const page = await this.db.send(new ScanCommand({
        TableName: table,
        ConsistentRead: true,
        FilterExpression: '#a = :v',
        ExpressionAttributeNames: { '#a': attribute },
        ExpressionAttributeValues: { ':v': { S: value } },
        ExclusiveStartKey: start,
      }));
      found.push(...(page.Items ?? []).map((item) => unmarshall(item)));
      start = page.LastEvaluatedKey;
    } while (start);
    return found;
  }

  async removeWhere(table: string, attribute: string, value: string, keyOf: (item: Record<string, any>) => Key) {
    for (const item of await this.find(table, attribute, value)) {
      await this.db.send(new DeleteItemCommand({ TableName: table, Key: marshall(keyOf(item)) }));
    }
  }

  async dispose() {
    for (const { table, key } of this.items.reverse()) {
      await this.db.send(new DeleteItemCommand({ TableName: table, Key: marshall(key) })).catch((e) => console.warn('cleanup', table, e.message));
    }
    for (const email of this.users) {
      await this.cognito.send(new AdminDeleteUserCommand({ UserPoolId: config.userPoolId, Username: email })).catch((e) => console.warn('cleanup user', e.message));
    }
    this.items.length = 0;
    this.users.length = 0;
  }
}
