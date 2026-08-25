import type { WorkspaceId } from '@customer-ops/tenancy';
import { describe, expect, it, vi } from 'vitest';
import { ChannelError, ChannelExternalIdentityConflictPersistenceError } from './errors';
import type { ChannelRepository } from './repositories/channel-repository';
import { ChannelService } from './channel-service';
import type { Channel, ChannelExternalRef, ChannelId, ChannelProviderKey } from './types';

const workspaceId = '11111111-1111-4111-8111-111111111111' as WorkspaceId;
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222' as WorkspaceId;
const channelId = '33333333-3333-4333-8333-333333333333' as ChannelId;
const now = new Date('2026-08-25T12:00:00.000Z');
const externalRef = 'External-AbC' as ChannelExternalRef;

function channel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: channelId,
    workspaceId,
    providerKey: 'test_provider' as ChannelProviderKey,
    displayName: 'Support',
    externalRef: null,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function fixture() {
  const mocks = {
    insertChannel: vi.fn<ChannelRepository['insertChannel']>().mockResolvedValue(undefined),
    findChannelWithinWorkspace: vi
      .fn<ChannelRepository['findChannelWithinWorkspace']>()
      .mockResolvedValue(channel()),
    listChannelsWithinWorkspace: vi
      .fn<ChannelRepository['listChannelsWithinWorkspace']>()
      .mockResolvedValue([channel()]),
    updateChannelWithinWorkspace: vi
      .fn<ChannelRepository['updateChannelWithinWorkspace']>()
      .mockImplementation((_workspace, _channel, update) =>
        Promise.resolve(
          channel({
            ...(update.displayName === undefined ? {} : { displayName: update.displayName }),
            ...(update.externalRef === undefined ? {} : { externalRef: update.externalRef }),
            ...(update.status === undefined ? {} : { status: update.status }),
            updatedAt: update.updatedAt,
          }),
        ),
      ),
    findChannelByProviderExternalRef: vi
      .fn<ChannelRepository['findChannelByProviderExternalRef']>()
      .mockResolvedValue(undefined),
  };
  const repository: ChannelRepository = mocks;
  const service = new ChannelService({
    repository,
    now: () => now,
    generateId: () => channelId,
  });
  return { mocks, service };
}

describe('ChannelService', () => {
  it('creates a validated provider-neutral pending channel with no external identity', async () => {
    const { mocks, service } = fixture();
    const created = await service.createPendingChannel(workspaceId, {
      providerKey: ' test_provider ',
      displayName: '  \u0642\u0646\u0627\u0629 Cafe\u0301  ',
    });
    expect(created).toStrictEqual(channel({ displayName: '\u0642\u0646\u0627\u0629 Caf\u00e9' }));
    expect(created.externalRef).toBeNull();
    expect(created.status).toBe('pending');
    expect(mocks.insertChannel).toHaveBeenCalledWith(created);
  });

  it('always scopes get/list/update lifecycle operations to the trusted workspace', async () => {
    const { mocks, service } = fixture();
    await service.getChannel(workspaceId, channelId);
    await service.listChannels(workspaceId);
    await service.disableChannel(workspaceId, channelId);
    expect(mocks.findChannelWithinWorkspace).toHaveBeenCalledWith(workspaceId, channelId);
    expect(mocks.listChannelsWithinWorkspace).toHaveBeenCalledWith(workspaceId);
    expect(mocks.updateChannelWithinWorkspace).toHaveBeenCalledWith(workspaceId, channelId, {
      status: 'disabled',
      updatedAt: now,
    });
    mocks.findChannelWithinWorkspace.mockResolvedValueOnce(undefined);
    await expect(service.getChannel(otherWorkspaceId, channelId)).rejects.toMatchObject({
      code: 'channel_not_found',
    });
  });

  it('binds an opaque identity, transitions to active, and maps only identity conflicts safely', async () => {
    const { mocks, service } = fixture();
    await expect(
      service.bindExternalIdentity(workspaceId, channelId, { externalRef: ' External-AbC ' }),
    ).resolves.toMatchObject({ externalRef, status: 'active' });
    expect(mocks.updateChannelWithinWorkspace).toHaveBeenCalledWith(workspaceId, channelId, {
      externalRef,
      status: 'active',
      updatedAt: now,
    });

    mocks.updateChannelWithinWorkspace.mockRejectedValueOnce(
      new ChannelExternalIdentityConflictPersistenceError(),
    );
    await expect(
      service.bindExternalIdentity(workspaceId, channelId, { externalRef }),
    ).rejects.toMatchObject({ code: 'channel_external_identity_conflict' });

    const unrelated = Object.assign(new Error('other unique'), { code: '23505' });
    mocks.updateChannelWithinWorkspace.mockRejectedValueOnce(unrelated);
    await expect(
      service.bindExternalIdentity(workspaceId, channelId, { externalRef }),
    ).rejects.toBe(unrelated);
  });

  it('is idempotent for the same active identity and never replaces a different identity', async () => {
    const { mocks, service } = fixture();
    const active = channel({ externalRef, status: 'active' });
    mocks.findChannelWithinWorkspace.mockResolvedValue(active);
    await expect(
      service.bindExternalIdentity(workspaceId, channelId, { externalRef }),
    ).resolves.toBe(active);
    await expect(
      service.bindExternalIdentity(workspaceId, channelId, { externalRef: 'Different-Ref' }),
    ).rejects.toMatchObject({ code: 'channel_external_identity_already_bound' });
    expect(mocks.updateChannelWithinWorkspace).not.toHaveBeenCalled();
  });

  it('detects a concurrent different-identity winner without silent replacement', async () => {
    const { mocks, service } = fixture();
    mocks.updateChannelWithinWorkspace.mockResolvedValueOnce(undefined);
    mocks.findChannelWithinWorkspace
      .mockResolvedValueOnce(channel())
      .mockResolvedValueOnce(
        channel({ externalRef: 'Concurrent-Ref' as ChannelExternalRef, status: 'active' }),
      );
    await expect(
      service.bindExternalIdentity(workspaceId, channelId, { externalRef }),
    ).rejects.toMatchObject({ code: 'channel_external_identity_already_bound' });
  });

  it('disables without releasing identity and reactivates only a bound disabled channel', async () => {
    const { mocks, service } = fixture();
    const active = channel({ externalRef, status: 'active' });
    mocks.findChannelWithinWorkspace.mockResolvedValueOnce(active);
    mocks.updateChannelWithinWorkspace.mockResolvedValueOnce(
      channel({ externalRef, status: 'disabled' }),
    );
    await expect(service.disableChannel(workspaceId, channelId)).resolves.toMatchObject({
      externalRef,
      status: 'disabled',
    });

    mocks.findChannelWithinWorkspace.mockResolvedValueOnce(
      channel({ externalRef, status: 'disabled' }),
    );
    mocks.updateChannelWithinWorkspace.mockResolvedValueOnce(active);
    await expect(service.reactivateBoundChannel(workspaceId, channelId)).resolves.toBe(active);

    mocks.findChannelWithinWorkspace.mockResolvedValueOnce(channel());
    await expect(service.reactivateBoundChannel(workspaceId, channelId)).rejects.toMatchObject({
      code: 'channel_external_identity_required',
    });
  });

  it('rejects binding on disabled channels and exposes safe error codes only', async () => {
    const { mocks, service } = fixture();
    mocks.findChannelWithinWorkspace.mockResolvedValue(channel({ status: 'disabled' }));
    await expect(
      service.bindExternalIdentity(workspaceId, channelId, { externalRef }),
    ).rejects.toStrictEqual(new ChannelError('channel_invalid_state'));
  });

  it('uses the explicitly global internal provider resolver and returns disabled mappings', async () => {
    const { mocks, service } = fixture();
    const disabled = channel({ externalRef, status: 'disabled' });
    mocks.findChannelByProviderExternalRef.mockResolvedValue(disabled);
    await expect(service.resolveProviderRoute(' test_provider ', ' External-AbC ')).resolves.toBe(
      disabled,
    );
    expect(mocks.findChannelByProviderExternalRef).toHaveBeenCalledWith(
      'test_provider',
      'External-AbC',
    );
    mocks.findChannelByProviderExternalRef.mockResolvedValueOnce(undefined);
    await expect(
      service.resolveProviderRoute('test_provider', 'Unknown-Ref'),
    ).resolves.toBeUndefined();
  });
});
