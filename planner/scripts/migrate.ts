import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { migrateUser, migrationOwners } from '../lib/migration';
const apply = process.argv.includes('--apply'),
  target = process.argv.find((a) => a.startsWith('--uid='))?.slice(6),
  backupDir = resolve(process.env.MIGRATION_BACKUP_DIR || 'migration-backups');
if (apply) await mkdir(backupDir, { recursive: true, mode: 0o700 });
const users = target ? [{ id: target }] : await migrationOwners();
for (const user of users) {
  const result = await migrateUser(
    user.id,
    async (encrypted) => {
      await writeFile(
        resolve(backupDir, user.id + '-' + Date.now() + '.sealed'),
        encrypted,
        { mode: 0o600, flag: 'wx' },
      );
    },
    apply,
  );
  console.log(JSON.stringify(result));
}
