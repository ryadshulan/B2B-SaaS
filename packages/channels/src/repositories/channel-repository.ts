import type { WorkspaceId } from '@customer-ops/tenancy';
import type {
  Channel,
  ChannelExternalRef,
  ChannelId,
  ChannelProviderKey,
  ChannelStatus,
} from '../types';

export interface ChannelUpdate {
  displayName?: string;
  externalRef?: ChannelExternalRef;
  status?: ChannelStatus;
  updatedAt: Date;
}

export interface ChannelRepository {
  insertChannel(channel: Channel): Promise<void>;
  findChannelWithinWorkspace(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
  ): Promise<Channel | undefined>;
  listChannelsWithinWorkspace(workspaceId: WorkspaceId): Promise<readonly Channel[]>;
  updateChannelWithinWorkspace(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    update: ChannelUpdate,
  ): Promise<Channel | undefined>;
  /** Internal provider-routing lookup only. This global resolver is never authorization. */
  findChannelByProviderExternalRef(
    providerKey: ChannelProviderKey,
    externalRef: ChannelExternalRef,
  ): Promise<Channel | undefined>;
}
