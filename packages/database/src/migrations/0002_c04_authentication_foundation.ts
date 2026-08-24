import { sql, type Migration } from 'kysely';

export const c04AuthenticationFoundation: Migration = {
  up: async (database) => {
    await database.schema
      .createTable('users')
      .addColumn('id', 'uuid', (column) => column.primaryKey())
      .addColumn('email', 'text', (column) => column.notNull())
      .addColumn('email_normalized', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('created_at', 'timestamptz', (column) => column.notNull())
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
      .addUniqueConstraint('users_email_normalized_unique', ['email_normalized'])
      .addCheckConstraint('users_status_check', sql`status in ('active', 'disabled')`)
      .execute();

    await database.schema
      .createTable('auth_password_credentials')
      .addColumn('user_id', 'uuid', (column) =>
        column.primaryKey().references('users.id').onDelete('cascade'),
      )
      .addColumn('password_hash', 'text', (column) => column.notNull())
      .addColumn('password_changed_at', 'timestamptz', (column) => column.notNull())
      .execute();

    await database.schema
      .createTable('auth_sessions')
      .addColumn('id', 'uuid', (column) => column.primaryKey())
      .addColumn('user_id', 'uuid', (column) =>
        column.notNull().references('users.id').onDelete('cascade'),
      )
      .addColumn('token_hash', 'text', (column) => column.notNull().unique())
      .addColumn('created_at', 'timestamptz', (column) => column.notNull())
      .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
      .addColumn('revoked_at', 'timestamptz')
      .execute();

    await database.schema
      .createIndex('auth_sessions_user_id_idx')
      .on('auth_sessions')
      .column('user_id')
      .execute();
    await database.schema
      .createIndex('auth_sessions_expires_at_idx')
      .on('auth_sessions')
      .column('expires_at')
      .execute();
    await database.schema
      .createIndex('auth_sessions_revoked_at_idx')
      .on('auth_sessions')
      .column('revoked_at')
      .execute();
    await database.schema
      .createIndex('auth_sessions_user_revocation_idx')
      .on('auth_sessions')
      .columns(['user_id', 'revoked_at'])
      .execute();
  },
  down: async (database) => {
    await database.schema.dropTable('auth_sessions').execute();
    await database.schema.dropTable('auth_password_credentials').execute();
    await database.schema.dropTable('users').execute();
  },
};
