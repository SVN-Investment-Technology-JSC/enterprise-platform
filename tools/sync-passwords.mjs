import crypto from 'node:crypto';
import { promisify } from 'node:util';
import pg from '../apps/migrator/node_modules/pg/lib/index.js';

const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

async function run() {
  const hash = await hashPassword('Password123!');
  console.log('Generated hash:', hash);

  const clientTenant = new pg.Client({
    connectionString: 'postgresql://tenant:tenant@localhost:55436/test',
  });
  await clientTenant.connect();
  const resTenant = await clientTenant.query(
    'UPDATE core_schema.users SET password_hash = $1',
    [hash]
  );
  console.log(`Updated ${resTenant.rowCount} users in tenant test db`);
  await clientTenant.end();

  const clientPlatform = new pg.Client({
    connectionString: 'postgresql://platform:platform@localhost:55432/platform',
  });
  await clientPlatform.connect();
  const resPlatform = await clientPlatform.query(
    'UPDATE identity_schema.users SET password_hash = $1',
    [hash]
  );
  console.log(`Updated ${resPlatform.rowCount} users in platform db`);
  await clientPlatform.end();
}

run().catch((err) => {
  console.error('Error syncing passwords:', err);
  process.exit(1);
});
