import type { WorkspaceId } from '@customer-ops/tenancy';

declare const channelIdBrand: unique symbol;
declare const channelProviderKeyBrand: unique symbol;
declare const channelExternalRefBrand: unique symbol;

export type ChannelId = string & { readonly [channelIdBrand]: 'ChannelId' };
export type ChannelProviderKey = string & {
  readonly [channelProviderKeyBrand]: 'ChannelProviderKey';
};
export type ChannelExternalRef = string & {
  readonly [channelExternalRefBrand]: 'ChannelExternalRef';
};

export const CHANNEL_STATUSES = Object.freeze(['pending', 'active', 'disabled'] as const);
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export const CHANNEL_PROVIDER_CAPABILITIES = Object.freeze(['inbound', 'outbound'] as const);
export type ChannelProviderCapability = (typeof CHANNEL_PROVIDER_CAPABILITIES)[number];

export interface Channel {
  id: ChannelId;
  workspaceId: WorkspaceId;
  providerKey: ChannelProviderKey;
  displayName: string;
  externalRef: ChannelExternalRef | null;
  status: ChannelStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChannelProviderDescriptor {
  readonly key: ChannelProviderKey;
  readonly capabilities: readonly ChannelProviderCapability[];
}

export interface ChannelsDatabaseSchema {
  channels: {
    id: string;
    workspace_id: string;
    provider_key: string;
    display_name: string;
    external_ref: string | null;
    status: ChannelStatus;
    created_at: Date;
    updated_at: Date;
  };
  workspaces: {
    id: string;
  };
}

export function isChannelStatus(value: unknown): value is ChannelStatus {
  return typeof value === 'string' && (CHANNEL_STATUSES as readonly string[]).includes(value);
}

export function isChannelProviderCapability(value: unknown): value is ChannelProviderCapability {
  return (
    typeof value === 'string' &&
    (CHANNEL_PROVIDER_CAPABILITIES as readonly string[]).includes(value)
  );
}
