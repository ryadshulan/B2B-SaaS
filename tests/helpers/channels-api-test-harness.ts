import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import type { AccessDatabaseSchema, AccessService } from '@customer-ops/access';
import type { AuthDatabaseSchema, AuthService } from '@customer-ops/auth';
import type { ChannelService, ChannelsDatabaseSchema } from '@customer-ops/channels';
import { loadDatabaseConfigFromEnvironment } from '@customer-ops/config';
import {
  createDatabase,
  migrateToLatest,
  type DatabaseExecutor,
  type DatabaseRuntime,
} from '@customer-ops/database';
import { createLogger } from '@customer-ops/logger';
import { ACCESS_SERVICE } from '../../apps/api/src/access/access-config';
import { createApiApplication } from '../../apps/api/src/bootstrap';
import { AUTH_SERVICE } from '../../apps/api/src/auth/auth-config';
import { CHANNEL_SERVICE } from '../../apps/api/src/channels/channels-config';

type ChannelsApiDatabaseSchema = AccessDatabaseSchema & AuthDatabaseSchema & ChannelsDatabaseSchema;

export interface ChannelsApiTestHarness {
  baseUrl: string;
  webOrigin: string;
  authService: AuthService;
  accessService: AccessService;
  channelService: ChannelService;
  executor: DatabaseExecutor<ChannelsApiDatabaseSchema>;
  output(): string;
  close(): Promise<void>;
}

function disposableSchema(): string {
  return `c08_channels_${randomUUID().replaceAll('-', '')}`;
}

function assertDisposableSchema(schema: string): void {
  if (!/^c08_channels_[0-9a-f]{32}$/u.test(schema)) {
    throw new Error('Refusing to clean a schema not owned by a C08 channels API test');
  }
}

function withSearchPath(databaseUrl: string, schema: string): string {
  assertDisposableSchema(schema);
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  return url.toString();
}

export async function startChannelsApiTestHarness(): Promise<ChannelsApiTestHarness> {
  const config = loadDatabaseConfigFromEnvironment();
  const schema = disposableSchema();
  const destination = new PassThrough();
  let output = '';
  destination.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  const logger = createLogger({
    service: 'channels-api-test',
    environment: 'test',
    level: 'debug',
    destination,
  });
  const adminDatabase = createDatabase({ config: { ...config, maxConnections: 2 } });
  let database: DatabaseRuntime<ChannelsApiDatabaseSchema> | undefined;
  let application: Awaited<ReturnType<typeof createApiApplication>> | undefined;

  try {
    await adminDatabase.executor.schema.createSchema(schema).execute();
    database = createDatabase<ChannelsApiDatabaseSchema>({
      config: {
        ...config,
        url: withSearchPath(config.url, schema),
        maxConnections: Math.min(config.maxConnections, 8),
      },
      logger,
    });
    await migrateToLatest(database, { migrationTableSchema: schema, logger });
    const webOrigin = 'http://localhost:3000';
    application = await createApiApplication({
      logger,
      database: database as unknown as DatabaseRuntime,
      auth: { webOrigin, sessionTtlSeconds: 604_800, secureCookies: false },
    });
    await application.listen(0, '127.0.0.1');
    const address = (
      application.getHttpServer() as { address(): AddressInfo | string | null }
    ).address();
    if (address === null || typeof address === 'string') {
      throw new Error('Channels test API did not expose a TCP address');
    }
    const ownedApplication = application;
    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      webOrigin,
      authService: application.get<AuthService>(AUTH_SERVICE),
      accessService: application.get<AccessService>(ACCESS_SERVICE),
      channelService: application.get<ChannelService>(CHANNEL_SERVICE),
      executor: database.executor,
      output: () => output,
      close: async () => {
        await ownedApplication.close();
        assertDisposableSchema(schema);
        await adminDatabase.executor.schema.dropSchema(schema).cascade().execute();
        await adminDatabase.close();
      },
    };
  } catch (error) {
    await application?.close().catch(() => undefined);
    await database?.close().catch(() => undefined);
    assertDisposableSchema(schema);
    await adminDatabase.executor.schema.dropSchema(schema).ifExists().cascade().execute();
    await adminDatabase.close();
    throw error;
  }
}
