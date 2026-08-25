import type { Channel, ChannelService } from '@customer-ops/channels';
import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import { businessResponse, type BusinessResponse } from '../access/success-response';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import {
  getWorkspaceAccessContext,
  type WorkspaceAccessRequest,
} from '../access/workspace-access-request';
import { RequirePermission, WorkspacePermissionGuard } from '../access/workspace-permission.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CHANNEL_SERVICE } from './channels-config';
import { translateChannelError } from './channels-error';
import { parseChannelId } from './channels-request-validation';

function channelResponse(channel: Channel) {
  return {
    id: channel.id,
    providerKey: channel.providerKey,
    displayName: channel.displayName,
    status: channel.status,
    hasExternalIdentity: channel.externalRef !== null,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  };
}

@Controller('workspaces/current/channels')
export class ChannelsController {
  constructor(@Inject(CHANNEL_SERVICE) private readonly channelService: ChannelService) {}

  @Get()
  @RequirePermission('channel.read')
  @UseGuards(SessionAuthGuard, WorkspaceAccessGuard, WorkspacePermissionGuard)
  async list(@Req() request: WorkspaceAccessRequest): Promise<BusinessResponse<unknown>> {
    const channels = await this.channelService.listChannels(
      getWorkspaceAccessContext(request).workspaceId,
    );
    return businessResponse({ channels: channels.map(channelResponse) });
  }

  @Get(':channelId')
  @RequirePermission('channel.read')
  @UseGuards(SessionAuthGuard, WorkspaceAccessGuard, WorkspacePermissionGuard)
  async get(
    @Req() request: WorkspaceAccessRequest,
    @Param('channelId') channelId: string,
  ): Promise<BusinessResponse<unknown>> {
    try {
      const channel = await this.channelService.getChannel(
        getWorkspaceAccessContext(request).workspaceId,
        parseChannelId(channelId),
      );
      return businessResponse({ channel: channelResponse(channel) });
    } catch (error) {
      return translateChannelError(error);
    }
  }
}
