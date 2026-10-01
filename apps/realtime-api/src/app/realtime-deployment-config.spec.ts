import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workspaceRoot = resolve(process.cwd(), '../..');

async function workspaceFile(path: string): Promise<string> {
  return readFile(resolve(workspaceRoot, path), 'utf8');
}

describe('realtime deployment configuration', () => {
  it('publishes container images for the realtime API and notification worker', async () => {
    const manifest = JSON.parse(
      await workspaceFile('tools/deployment/services.json'),
    ) as {
      services: Array<{ id: string; dockerfile: string }>;
    };

    expect(manifest.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'realtime-api',
          dockerfile: 'apps/realtime-api/Dockerfile',
        }),
        expect.objectContaining({
          id: 'notification-worker',
          dockerfile: 'apps/notification-worker/Dockerfile',
        }),
      ]),
    );
  });

  it.each([
    'infrastructure/docker/compose.local.yml',
    'infrastructure/docker/compose.full.yml',
    'infrastructure/docker/compose.coolify.yml',
  ])('configures Valkey 9.1.2 with ACL authentication and health checks in %s', async (path) => {
    const compose = await workspaceFile(path);

    expect(compose).toContain('valkey/valkey:9.1.2-alpine');
    expect(compose).toMatch(/user realtime on/);
    expect(compose).toMatch(/valkey-cli[^\n]+--user[^\n]+realtime[^\n]+ping/);
  });

  it.each([
    'infrastructure/docker/compose.full.yml',
    'infrastructure/docker/compose.coolify.yml',
  ])('runs both realtime processes with rollout flags in %s', async (path) => {
    const compose = await workspaceFile(path);

    expect(compose).toMatch(/\n {2}realtime-api:\n/);
    expect(compose).toMatch(/\n {2}notification-worker:\n/);
    expect(compose).toContain('REALTIME_DELIVERY_ENABLED:');
    expect(compose).toContain('NOTIFICATION_CONSUMER_ENABLED:');
    expect(compose).toContain('redis://realtime:');
  });

  it.each([
    'infrastructure/nginx/nginx.conf',
    'infrastructure/nginx/nginx.docker.conf',
  ])('routes REST and WebSocket traffic with upgrade headers in %s', async (path) => {
    const nginx = await workspaceFile(path);

    expect(nginx).toMatch(/upstream realtime_api[\s\S]+3338/);
    expect(nginx).toMatch(/location \^~ \/api\/realtime\/[\s\S]+proxy_pass http:\/\/realtime_api/);
    expect(nginx).toMatch(/location \^~ \/realtime\/socket\.io[\s\S]+proxy_pass http:\/\/realtime_api/);
    expect(nginx).toMatch(/proxy_set_header Upgrade \$http_upgrade/);
    expect(nginx).toMatch(/proxy_set_header Connection \$connection_upgrade/);
    expect(nginx).toMatch(/proxy_read_timeout 75s/);
  });

  it('documents required secrets, origins and rollout flags for local and production validation', async () => {
    const [localEnv, dockerEnv, workflow] = await Promise.all([
      workspaceFile('.env.example'),
      workspaceFile('.env.docker.example'),
      workspaceFile('.github/workflows/ci-cd.yml'),
    ]);

    for (const variable of [
      'VALKEY_PASSWORD',
      'REALTIME_ALLOWED_ORIGINS',
      'REALTIME_DELIVERY_ENABLED',
      'REALTIME_MUTATIONS_ENABLED',
      'NOTIFICATION_CONSUMER_ENABLED',
    ]) {
      expect(localEnv).toContain(`${variable}=`);
      expect(dockerEnv).toContain(`${variable}=`);
      expect(workflow).toContain(`${variable}:`);
    }
  });
});
