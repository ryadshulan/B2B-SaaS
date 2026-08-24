import { sql, type Migration } from 'kysely';

export const c07Teams: Migration = {
  up: async (database) => {
    await database.schema
      .alterTable('workspace_memberships')
      .addUniqueConstraint('workspace_memberships_id_workspace_unique', ['id', 'workspace_id'])
      .execute();

    await database.schema
      .createTable('teams')
      .addColumn('id', 'uuid', (column) => column.primaryKey())
      .addColumn('workspace_id', 'uuid', (column) =>
        column.notNull().references('workspaces.id').onDelete('restrict'),
      )
      .addColumn('name', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('created_at', 'timestamptz', (column) => column.notNull())
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
      .addUniqueConstraint('teams_workspace_name_unique', ['workspace_id', 'name'])
      .addUniqueConstraint('teams_id_workspace_unique', ['id', 'workspace_id'])
      .addCheckConstraint('teams_status_check', sql`status in ('active', 'disabled')`)
      .execute();

    await database.schema
      .createTable('team_memberships')
      .addColumn('id', 'uuid', (column) => column.primaryKey())
      .addColumn('workspace_id', 'uuid', (column) => column.notNull())
      .addColumn('team_id', 'uuid', (column) => column.notNull())
      .addColumn('workspace_membership_id', 'uuid', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('created_at', 'timestamptz', (column) => column.notNull())
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
      .addUniqueConstraint('team_memberships_team_workspace_membership_unique', [
        'team_id',
        'workspace_membership_id',
      ])
      .addCheckConstraint('team_memberships_status_check', sql`status in ('active', 'disabled')`)
      .addForeignKeyConstraint(
        'team_memberships_team_workspace_fk',
        ['team_id', 'workspace_id'],
        'teams',
        ['id', 'workspace_id'],
        (constraint) => constraint.onDelete('restrict'),
      )
      .addForeignKeyConstraint(
        'team_memberships_workspace_membership_workspace_fk',
        ['workspace_membership_id', 'workspace_id'],
        'workspace_memberships',
        ['id', 'workspace_id'],
        (constraint) => constraint.onDelete('restrict'),
      )
      .execute();
  },
  down: async (database) => {
    await database.schema.dropTable('team_memberships').execute();
    await database.schema.dropTable('teams').execute();
    await database.schema
      .alterTable('workspace_memberships')
      .dropConstraint('workspace_memberships_id_workspace_unique')
      .execute();
  },
};
