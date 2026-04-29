import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBGsRJLvGskQn6MYY1YnT_Z8rYIC0YCKhM',
  authDomain: 'manabites-f3664.firebaseapp.com',
  projectId: 'manabites-f3664',
  storageBucket: 'manabites-f3664.firebasestorage.app',
  messagingSenderId: '237962562883',
  appId: '1:237962562883:web:e99d1917b8ec559f90f3f6',
};

const app = initializeApp(firebaseConfig, 'seed');
const auth = getAuth(app);
const db = getFirestore(app, 'manabites');

const rider = {
  name: 'Charan Teja',
  email: 'charantejnatha@gmail.com',
  phone: '7670852530',
  vehicleType: 'Bike',
  vehicleNumber: 'TS00XX0000',
};

const password = 'Manabites@123';

async function main() {
  console.log(`Creating rider: ${rider.name} (${rider.email})`);

  let uid: string;

  try {
    const { user } = await createUserWithEmailAndPassword(auth, rider.email, password);
    uid = user.uid;
    console.log(`Firebase Auth user created: ${uid}`);
  } catch (err: any) {
    if (err.code === 'auth/email-already-in-use') {
      console.log('Auth account already exists — signing in to get UID...');
      try {
        const { user } = await signInWithEmailAndPassword(auth, rider.email, password);
        uid = user.uid;
        console.log(`Signed in, UID: ${uid}`);
      } catch {
        // Unknown existing password — send reset email and bail
        await sendPasswordResetEmail(auth, rider.email);
        console.log(`Could not sign in. Password reset email sent to ${rider.email}.`);
        console.log('Ask the rider to reset their password, then re-run this script.');
        process.exit(1);
      }
    } else {
      throw err;
    }
  }

  await setDoc(doc(db, 'users', uid), {
    uid,
    role: 'rider',
    name: rider.name,
    email: rider.email,
    phone: rider.phone,
    vehicleType: rider.vehicleType,
    vehicleNumber: rider.vehicleNumber,
    isActive: true,
    licenseApproved: false,
    bankApproved: false,
    createdAt: serverTimestamp(),
  }, { merge: true });

  await signOut(auth);

  console.log('\nRider added successfully!');
  console.log('----------------------------');
  console.log(`Name    : ${rider.name}`);
  console.log(`Email   : ${rider.email}`);
  console.log(`Phone   : ${rider.phone}`);
  console.log(`Password: ${password}`);
  console.log('----------------------------');
  console.log('Share these credentials with the rider.');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
