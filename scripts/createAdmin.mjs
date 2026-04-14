/**
 * Create an Admin account for Manabites
 *
 * Usage:
 *   node scripts/createAdmin.mjs <email> <password>
 *
 * Example:
 *   node scripts/createAdmin.mjs admin@manabites.com Admin@1234
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const firebaseConfig = require('../firebase-applet-config.json');

// ── Args ──────────────────────────────────────────────────────────────────────

const [,, email, password] = process.argv;

if (!email || !password) {
  console.error('\nUsage: node scripts/createAdmin.mjs <email> <password>\n');
  console.error('Example: node scripts/createAdmin.mjs admin@manabites.com Admin@1234\n');
  process.exit(1);
}

if (password.length < 6) {
  console.error('\nPassword must be at least 6 characters.\n');
  process.exit(1);
}

// ── Firebase init ─────────────────────────────────────────────────────────────

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// ── Create user ───────────────────────────────────────────────────────────────

async function run() {
  let uid;

  // Try creating a new user first
  try {
    console.log(`\nCreating Firebase Auth user: ${email} ...`);
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    uid = cred.user.uid;
    console.log(`✓ Auth user created  (uid: ${uid})`);
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      // User already exists — sign in to get the UID
      console.log('  User already exists in Auth, fetching UID by signing in...');
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        uid = cred.user.uid;
        console.log(`✓ Signed in, uid: ${uid}`);
      } catch (signInErr) {
        console.error(`\n✗ Could not sign in: ${signInErr.message}`);
        console.error('  The user exists but the password is wrong.');
        console.error('  Reset the password from Firebase Console > Authentication.\n');
        process.exit(1);
      }
    } else {
      console.error(`\n✗ Failed to create user: ${err.message}\n`);
      process.exit(1);
    }
  }

  // Add to /admins collection
  try {
    console.log(`Adding ${email} to /admins Firestore collection...`);
    await setDoc(
      doc(db, 'admins', uid),
      {
        uid,
        email,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
    console.log('✓ Admin record written to Firestore\n');
  } catch (err) {
    console.error(`\n✗ Firestore write failed: ${err.message}`);
    console.error('  Make sure your Firestore security rules allow writes to /admins.');
    console.error('  Temporarily allow writes during setup:\n');
    console.error('    match /admins/{id} { allow read, write: if true; }\n');
    process.exit(1);
  }

  // Also write to /users with role=admin (belt-and-suspenders)
  try {
    await setDoc(
      doc(db, 'users', uid),
      {
        uid,
        email,
        role: 'admin',
        isActive: true,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
    console.log('✓ User record written to /users (role: admin)\n');
  } catch {
    // non-fatal
  }

  console.log('─'.repeat(50));
  console.log('  Admin account ready!');
  console.log(`  Email    : ${email}`);
  console.log(`  Password : ${password}`);
  console.log(`  UID      : ${uid}`);
  console.log('─'.repeat(50));
  console.log('\n  Open http://localhost:3001 and sign in.\n');

  process.exit(0);
}

run().catch(err => {
  console.error('\nUnexpected error:', err);
  process.exit(1);
});
