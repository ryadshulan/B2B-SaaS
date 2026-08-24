import { sql, type Migration } from 'kysely';

export const c06WorkspaceMembershipsRbac: Migration = {
  up: async (database) => {
    await database.schema
      .createTable('workspace_memberships')
      .addColumn('id', 'uuid', (column) => column.primaryKey())
      .addColumn('workspace_id', 'uuid', (column) =>
        column.notNull().references('workspaces.id').onDelete('restrict'),
      )
      .addColumn('user_id', 'uuid', (column) =>
        column.notNull().references('users.id').onDelete('restrict'),
      )
      .addColumn('role', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('created_at', 'timestamptz', (column) => column.notNull())
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
      .addUniqueConstraint('workspace_memberships_workspace_user_unique', [
        'workspace_id',
        'user_id',
      ])
      .addCheckConstraint(
        'workspace_memberships_role_check',
        sql`role in ('owner', 'admin', 'supervisor', 'agent', 'marketing', 'analyst')`,
      )
      .addCheckConstraint(
        'workspace_memberships_status_check',
        sql`status in ('active', 'disabled')`,
      )
      .execute();

    await database.schema
      .createIndex('workspace_memberships_user_status_idx')
      .on('workspace_memberships')
      .columns(['user_id', 'status'])
      .execute();
  },
  down: async (database) => {
    await database.schema.dropTable('workspace_memberships').execute();
  },
};
