// Usage: npm run admin:enrol -- <username> ["Display name"]
// Creates the user as an admin if they don't exist, then prints a fresh one-time enrolment link.
// Use it for the first admin, or to recover access if an admin loses every passkey.
import { loadConfig } from '../config.ts';
import { openDb } from '../openDb.ts';
import { createUser, getUserByUsername, issueEnrolment, normaliseUsername, updateUser, USERNAME_RE } from '../users.ts';

const [rawUsername, displayName] = process.argv.slice(2);
const username = normaliseUsername(rawUsername ?? '');
if (!USERNAME_RE.test(username)) {
  console.error('Usage: npm run admin:enrol -- <username> ["Display name"]  (2–32 lowercase letters, digits, . _ -)');
  process.exit(1);
}

const config = loadConfig();
const db = await openDb(config);
let user = await getUserByUsername(db, username);
if (!user) {
  user = await createUser(db, { username, display_name: displayName ?? username, role: 'admin' });
  console.log(`Created admin "${username}".`);
} else if (user.disabled_at) {
  user = (await updateUser(db, user.id, { disabled: false }))!;
  console.log(`Re-enabled "${username}".`);
}
const token = await issueEnrolment(db, user.id, null);
console.log(`One-time enrolment link (valid 24 hours):\n  ${config.origin}/enrol/${token}`);
await db.close();
