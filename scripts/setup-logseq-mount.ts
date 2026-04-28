/**
 * Configures the Logseq vault mount for the main NanoClaw group.
 * Run once with the path to your Logseq vault on the Linux filesystem.
 *
 * Usage: npx tsx scripts/setup-logseq-mount.ts /path/to/logseq/vault
 */
import fs from 'fs';
import path from 'path';

import { initDatabase, getAllRegisteredGroups, setRegisteredGroup } from '../src/db.js';
import { MOUNT_ALLOWLIST_PATH } from '../src/config.js';

const vaultPath = process.argv[2];

if (!vaultPath) {
  console.error('Usage: npx tsx scripts/setup-logseq-mount.ts /path/to/logseq/vault');
  process.exit(1);
}

const resolved = path.resolve(vaultPath.replace(/^~/, process.env.HOME || ''));

if (!fs.existsSync(resolved)) {
  console.error(`Path does not exist: ${resolved}`);
  process.exit(1);
}

if (!fs.statSync(resolved).isDirectory()) {
  console.error(`Path is not a directory: ${resolved}`);
  process.exit(1);
}

// 1. Add vault root to mount allowlist
const allowlistDir = path.dirname(MOUNT_ALLOWLIST_PATH);
fs.mkdirSync(allowlistDir, { recursive: true });

let allowlist: {
  allowedRoots: Array<{ path: string; allowReadWrite: boolean; description?: string }>;
  blockedPatterns: string[];
  nonMainReadOnly: boolean;
} = { allowedRoots: [], blockedPatterns: [], nonMainReadOnly: true };

if (fs.existsSync(MOUNT_ALLOWLIST_PATH)) {
  allowlist = JSON.parse(fs.readFileSync(MOUNT_ALLOWLIST_PATH, 'utf-8'));
}

const alreadyAllowed = allowlist.allowedRoots.some((r) => resolved.startsWith(r.path.replace(/^~/, process.env.HOME || '')));
if (!alreadyAllowed) {
  allowlist.allowedRoots.push({
    path: resolved,
    allowReadWrite: true,
    description: 'Logseq knowledge vault',
  });
  fs.writeFileSync(MOUNT_ALLOWLIST_PATH, JSON.stringify(allowlist, null, 2) + '\n');
  console.log(`✓ Added to mount allowlist: ${resolved}`);
} else {
  console.log(`  Already in allowlist: ${resolved}`);
}

// 2. Add additionalMount to the main group's containerConfig
initDatabase();
const groups = getAllRegisteredGroups();
const mainEntry = Object.entries(groups).find(([, g]) => g.isMain || g.folder === 'main');

if (!mainEntry) {
  console.error('No main group found in database. Register your main group first.');
  process.exit(1);
}

const [mainJid, mainGroup] = mainEntry;
const existingMounts = mainGroup.containerConfig?.additionalMounts ?? [];
const alreadyMounted = existingMounts.some((m) => m.hostPath === resolved);

if (!alreadyMounted) {
  const updated = {
    ...mainGroup,
    containerConfig: {
      ...mainGroup.containerConfig,
      additionalMounts: [
        ...existingMounts,
        {
          hostPath: resolved,
          containerPath: 'logseq',
          readonly: false,
        },
      ],
    },
  };
  setRegisteredGroup(mainJid, updated);
  console.log(`✓ Logseq mount added to main group (JID: ${mainJid})`);
  console.log(`  Host: ${resolved}`);
  console.log(`  Container: /workspace/extra/logseq`);
} else {
  console.log(`  Logseq mount already configured for main group.`);
}

console.log('\nDone. Restart NanoClaw for the mount to take effect.');
