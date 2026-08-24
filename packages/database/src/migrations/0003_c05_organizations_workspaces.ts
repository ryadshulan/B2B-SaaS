import { sql, type Migration } from 'kysely';

export const c05OrganizationsWorkspaces: Migration = {
  up: async (database) => {
    await database.schema
      .createTable('organizations')
      .addColumn('id', 'uuid', (column) => column.primaryKey())
      .addColumn('name', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('created_at', 'timestamptz', (column) => column.notNull())
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
      .addCheckConstraint('organizations_status_check', sql`status in ('active', 'disabled')`)
      .execute();

    await database.schema
      .createTable('workspaces')
      .addColumn('id', 'uuid', (column) => column.primaryKey())
      .addColumn('organization_id', 'uuid', (column) =>
        column.notNull().references('organizations.id').onDelete('restrict'),
      )
      .addColumn('name', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('created_at', 'timestamptz', (column) => column.notNull())
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
      .addCheckConstraint('workspaces_status_check', sql`status in ('active', 'disabled')`)
      .execute();

    await database.schema
      .createIndex('workspaces_organization_id_idx')
      .on('workspaces')
      .column('organization_id')
      .execute();
  },
  down: async (database) => {
    await database.schema.dropTable('workspaces').execute();
    await database.schema.dropTable('organizations').execute();
  },
};
