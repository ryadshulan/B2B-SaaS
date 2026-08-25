import { sql, type Migration } from 'kysely';

export const c08Channels: Migration = {
  up: async (database) => {
    await database.schema
      .createTable('channels')
      .addColumn('id', 'uuid', (column) => column.primaryKey())
      .addColumn('workspace_id', 'uuid', (column) =>
        column.notNull().references('workspaces.id').onDelete('restrict'),
      )
      .addColumn('provider_key', 'text', (column) => column.notNull())
      .addColumn('display_name', 'text', (column) => column.notNull())
      .addColumn('external_ref', 'text')
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('created_at', 'timestamptz', (column) => column.notNull())
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
      .addUniqueConstraint('channels_id_workspace_unique', ['id', 'workspace_id'])
      .addCheckConstraint('channels_status_check', sql`status in ('pending', 'active', 'disabled')`)
      .addCheckConstraint(
        'channels_active_external_ref_check',
        sql`status <> 'active' or external_ref is not null`,
      )
      .execute();

    await database.schema
      .createIndex('channels_provider_external_ref_unique')
      .unique()
      .on('channels')
      .columns(['provider_key', 'external_ref'])
      .where('external_ref', 'is not', null)
      .execute();

    await database.schema
      .createIndex('channels_workspace_status_idx')
      .on('channels')
      .columns(['workspace_id', 'status'])
      .execute();
  },
  down: async (database) => {
    await database.schema.dropTable('channels').execute();
  },
};
