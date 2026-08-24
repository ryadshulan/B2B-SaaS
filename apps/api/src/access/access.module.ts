import {
  createPostgresAccessService,
  createPostgresOrganizationBootstrapService,
} from '@customer-ops/access';
import type { DatabaseRuntime } from '@customer-ops/database';
import type { StructuredLogger } from '@customer-ops/logger';
import { Module, type DynamicModule } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import type { AuthHttpConfig } from '../auth/auth-config';
import { DATABASE_RUNTIME } from '../database/database.module';
import { ACCESS_SERVICE, ORGANIZATION_BOOTSTRAP_SERVICE } from './access-config';
import { OrganizationsController } from './organizations.controller';
import { WorkspaceAccessGuard } from './workspace-access.guard';
import { WorkspacePermissionGuard } from './workspace-permission.guard';
import { WorkspacesController } from './workspaces.controller';

@Module({})
export class AccessModule {
  static register(config: AuthHttpConfig, logger: StructuredLogger): DynamicModule {
    return {
      module: AccessModule,
      imports: [AuthModule.register(config, logger)],
      controllers: [OrganizationsController, WorkspacesController],
      providers: [
        {
          provide: ACCESS_SERVICE,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: DatabaseRuntime) => createPostgresAccessService(database),
        },
        {
          provide: ORGANIZATION_BOOTSTRAP_SERVICE,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: DatabaseRuntime) =>
            createPostgresOrganizationBootstrapService(database),
        },
        WorkspaceAccessGuard,
        WorkspacePermissionGuard,
      ],
      exports: [ACCESS_SERVICE, WorkspaceAccessGuard, WorkspacePermissionGuard],
    };
  }
}
