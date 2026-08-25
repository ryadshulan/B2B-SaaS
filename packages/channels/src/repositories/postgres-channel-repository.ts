import type { DatabaseExecutor } from '@customer-ops/database';
import type { WorkspaceId } from '@customer-ops/tenancy';
import { ChannelExternalIdentityConflictPersistenceError } from '../errors';
import type {
  Channel,
  ChannelExternalRef,
  ChannelId,
  ChannelProviderKey,
  ChannelsDatabaseSchema,
} from '../types';
import type { ChannelRepository, ChannelUpdate } from './channel-repository';

const PROVIDER_IDENTITY_UNIQUE_INDEX = 'channels_provider_external_ref_unique';

function isProviderIdentityConflict(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === '23505' && candidate.constraint === PROVIDER_IDENTITY_UNIQUE_INDEX;
}

function toChannel(row: ChannelsDatabaseSchema['channels']): Channel {
  return {
    id: row.id as ChannelId,
    workspaceId: row.workspace_id as WorkspaceId,
    providerKey: row.provider_key as ChannelProviderKey,
    displayName: row.display_name,
    externalRef: row.external_ref as ChannelExternalRef | null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class PostgresChannelRepository implements ChannelRepository {
  constructor(private readonly executor: DatabaseExecutor<ChannelsDatabaseSchema>) {}

  async insertChannel(channel: Channel): Promise<void> {
    try {
      await this.executor
        .insertInto('channels')
        .values({
          id: channel.id,
          workspace_id: channel.workspaceId,
          provider_key: channel.providerKey,
          display_name: channel.displayName,
          external_ref: channel.externalRef,
          status: channel.status,
          created_at: channel.createdAt,
          updated_at: channel.updatedAt,
        })
        .execute();
    } catch (error) {
      if (isProviderIdentityConflict(error)) {
        throw new ChannelExternalIdentityConflictPersistenceError();
      }
      throw error;
    }
  }

  async findChannelWithinWorkspace(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
  ): Promise<Channel | undefined> {
    const row = await this.executor
      .selectFrom('channels')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', channelId)
      .executeTakeFirst();
    return row === undefined ? undefined : toChannel(row);
  }

  async listChannelsWithinWorkspace(workspaceId: WorkspaceId): Promise<readonly Channel[]> {
    const rows = await this.executor
      .selectFrom('channels')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(toChannel);
  }

  async updateChannelWithinWorkspace(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    update: ChannelUpdate,
  ): Promise<Channel | undefined> {
    const { displayName, externalRef, status, updatedAt } = update;
    let query = this.executor
      .updateTable('channels')
      .set({
        ...(displayName === undefined ? {} : { display_name: displayName }),
        ...(externalRef === undefined ? {} : { external_ref: externalRef }),
        ...(status === undefined ? {} : { status }),
        updated_at: updatedAt,
      })
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', channelId);

    // Identity binding is set-once. This predicate prevents concurrent silent replacement.
    if (externalRef !== undefined) query = query.where('external_ref', 'is', null);

    try {
      const row = await query.returningAll().executeTakeFirst();
      return row === undefined ? undefined : toChannel(row);
    } catch (error) {
      if (isProviderIdentityConflict(error)) {
        throw new ChannelExternalIdentityConflictPersistenceError();
      }
      throw error;
    }
  }

  /** Internal provider-routing lookup only. It does not establish workspace authorization. */
  async findChannelByProviderExternalRef(
    providerKey: ChannelProviderKey,
    externalRef: ChannelExternalRef,
  ): Promise<Channel | undefined> {
    const row = await this.executor
      .selectFrom('channels')
      .selectAll()
      .where('provider_key', '=', providerKey)
      .where('external_ref', '=', externalRef)
      .executeTakeFirst();
    return row === undefined ? undefined : toChannel(row);
  }
}

export function createPostgresChannelRepository<Schema extends ChannelsDatabaseSchema>(
  executor: DatabaseExecutor<Schema>,
): ChannelRepository {
  return new PostgresChannelRepository(
    executor as unknown as DatabaseExecutor<ChannelsDatabaseSchema>,
  );
}
