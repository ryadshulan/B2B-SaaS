import { randomUUID } from 'node:crypto';
import type { DatabaseRuntime } from '@customer-ops/database';
import type { WorkspaceId } from '@customer-ops/tenancy';
import { ChannelError, ChannelExternalIdentityConflictPersistenceError } from './errors';
import { createPostgresChannelRepository } from './repositories/postgres-channel-repository';
import type { ChannelRepository } from './repositories/channel-repository';
import type { Channel, ChannelId, ChannelsDatabaseSchema } from './types';
import {
  validateChannelDisplayName,
  validateChannelExternalRef,
  validateChannelProviderKey,
} from './validation';

export interface ChannelServiceOptions {
  repository: ChannelRepository;
  now?: () => Date;
  generateId?: () => string;
}

export interface CreatePendingChannelInput {
  providerKey: unknown;
  displayName: unknown;
}

export interface BindExternalIdentityInput {
  externalRef: unknown;
}

export class ChannelService {
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(private readonly options: ChannelServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? randomUUID;
  }

  async createPendingChannel(
    workspaceId: WorkspaceId,
    input: CreatePendingChannelInput,
  ): Promise<Channel> {
    const providerKey = validateChannelProviderKey(input?.providerKey);
    const displayName = validateChannelDisplayName(input?.displayName);
    const now = this.now();
    const channel: Channel = {
      id: this.generateId() as ChannelId,
      workspaceId,
      providerKey,
      displayName,
      externalRef: null,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    await this.options.repository.insertChannel(channel);
    return channel;
  }

  async getChannel(workspaceId: WorkspaceId, channelId: ChannelId): Promise<Channel> {
    const channel = await this.options.repository.findChannelWithinWorkspace(
      workspaceId,
      channelId,
    );
    if (channel === undefined) throw new ChannelError('channel_not_found');
    return channel;
  }

  listChannels(workspaceId: WorkspaceId): Promise<readonly Channel[]> {
    return this.options.repository.listChannelsWithinWorkspace(workspaceId);
  }

  async bindExternalIdentity(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    input: BindExternalIdentityInput,
  ): Promise<Channel> {
    const externalRef = validateChannelExternalRef(input?.externalRef);
    const existing = await this.getChannel(workspaceId, channelId);
    if (existing.status === 'disabled') throw new ChannelError('channel_invalid_state');
    if (existing.externalRef !== null) {
      if (existing.externalRef !== externalRef) {
        throw new ChannelError('channel_external_identity_already_bound');
      }
      if (existing.status === 'active') return existing;
      const activated = await this.options.repository.updateChannelWithinWorkspace(
        workspaceId,
        channelId,
        { status: 'active', updatedAt: this.now() },
      );
      if (activated === undefined) throw new ChannelError('channel_not_found');
      return activated;
    }

    try {
      const bound = await this.options.repository.updateChannelWithinWorkspace(
        workspaceId,
        channelId,
        { externalRef, status: 'active', updatedAt: this.now() },
      );
      if (bound !== undefined) return bound;
    } catch (error) {
      if (error instanceof ChannelExternalIdentityConflictPersistenceError) {
        throw new ChannelError('channel_external_identity_conflict');
      }
      throw error;
    }

    // A concurrent update won the set-once predicate. Re-read to return same-ref idempotently
    // or report an attempted replacement without exposing the stored identity.
    const concurrent = await this.options.repository.findChannelWithinWorkspace(
      workspaceId,
      channelId,
    );
    if (concurrent === undefined) throw new ChannelError('channel_not_found');
    if (concurrent.externalRef === externalRef && concurrent.status === 'active') return concurrent;
    if (concurrent.externalRef !== null) {
      throw new ChannelError('channel_external_identity_already_bound');
    }
    throw new ChannelError('channel_invalid_state');
  }

  async disableChannel(workspaceId: WorkspaceId, channelId: ChannelId): Promise<Channel> {
    const existing = await this.getChannel(workspaceId, channelId);
    if (existing.status === 'disabled') return existing;
    const disabled = await this.options.repository.updateChannelWithinWorkspace(
      workspaceId,
      channelId,
      { status: 'disabled', updatedAt: this.now() },
    );
    if (disabled === undefined) throw new ChannelError('channel_not_found');
    return disabled;
  }

  async reactivateBoundChannel(workspaceId: WorkspaceId, channelId: ChannelId): Promise<Channel> {
    const existing = await this.getChannel(workspaceId, channelId);
    if (existing.externalRef === null) {
      throw new ChannelError('channel_external_identity_required');
    }
    if (existing.status === 'active') return existing;
    if (existing.status !== 'disabled') throw new ChannelError('channel_invalid_state');
    const active = await this.options.repository.updateChannelWithinWorkspace(
      workspaceId,
      channelId,
      { status: 'active', updatedAt: this.now() },
    );
    if (active === undefined) throw new ChannelError('channel_not_found');
    return active;
  }

  /**
   * Internal provider-routing resolution only. It is global by design, returns the stored owning
   * workspace from PostgreSQL, includes disabled mappings, and must never authorize workspace access.
   */
  resolveProviderRoute(providerKey: unknown, externalRef: unknown): Promise<Channel | undefined> {
    return this.options.repository.findChannelByProviderExternalRef(
      validateChannelProviderKey(providerKey),
      validateChannelExternalRef(externalRef),
    );
  }
}

export function createPostgresChannelService<Schema>(
  database: DatabaseRuntime<Schema>,
  options: Pick<ChannelServiceOptions, 'now' | 'generateId'> = {},
): ChannelService {
  const channelsDatabase = database as unknown as DatabaseRuntime<ChannelsDatabaseSchema>;
  return new ChannelService({
    repository: createPostgresChannelRepository(channelsDatabase.executor),
    ...options,
  });
}
