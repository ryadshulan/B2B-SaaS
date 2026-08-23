import { sql, type Migration } from 'kysely';

export const c02DatabaseBaseline: Migration = {
  up: async (database) => {
    await sql`select 1`.execute(database);
  },
  down: async (database) => {
    await sql`select 1`.execute(database);
  },
};
