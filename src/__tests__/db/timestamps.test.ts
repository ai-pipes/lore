/** Timestamps are instants: stored with their time zone and handed to browsers as ISO-8601 UTC. */
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { getDb } from '../../platform/db.js';
import { pgChatRepository } from '../../modules/chat/infrastructure/pg-chat.js';
import { cleanDb, createTestUser } from '../helpers.js';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** An ISO-8601 UTC string within a minute of now, whatever the time zone of the reader. */
function expectRecentIsoUtc(value: string): void {
  expect(value).toMatch(ISO_UTC);
  expect(Math.abs(Date.parse(value) - Date.now())).toBeLessThan(60_000);
}

beforeEach(async () => {
  await cleanDb();
});

describe('timestamp columns', () => {
  it('all carry a time zone, so now() means the same instant on any server time zone', async () => {
    const rows = await getDb().execute(sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'
      ORDER BY table_name, column_name`);
    expect([...rows]).toEqual([]);
  });
});

describe('pgChatRepository timestamps', () => {
  it('reports sessions and messages as ISO-8601 UTC instants', async () => {
    const owner = await createTestUser({ login: 'tz-owner' });
    const created = await pgChatRepository.create(owner.id, { title: 'tz' });
    expectRecentIsoUtc(created.created_at);
    expectRecentIsoUtc(created.updated_at);

    const message = await pgChatRepository.addMessage(owner.id, created.id, 'user', 'hi', null);
    expectRecentIsoUtc(message!.created_at);

    const [listed] = await pgChatRepository.list(owner.id, 10);
    expectRecentIsoUtc(listed.updated_at);

    const fetched = await pgChatRepository.get(owner.id, created.id);
    expectRecentIsoUtc(fetched!.updated_at);

    const updated = await pgChatRepository.update(owner.id, created.id, { title: 'renamed' });
    expectRecentIsoUtc(updated!.updated_at);

    const [stored] = (await pgChatRepository.messages(owner.id, created.id))!;
    expectRecentIsoUtc(stored.created_at);
  });
});
