import type { WorkspaceAccessContext } from '@customer-ops/access';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

export interface WorkspaceAccessRequest extends AuthenticatedRequest {
  workspaceAccessContext?: WorkspaceAccessContext;
}

export function getWorkspaceAccessContext(request: WorkspaceAccessRequest): WorkspaceAccessContext {
  if (request.workspaceAccessContext === undefined) {
    throw new Error('Workspace access context was not attached by the workspace access guard');
  }
  return request.workspaceAccessContext;
}
