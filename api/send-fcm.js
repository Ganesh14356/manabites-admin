/**
 * Vercel serverless function — Firebase Cloud Messaging broadcast
 *
 * POST /api/send-fcm
 * Body: { title, message, audience }
 * audience: 'all_customers' | 'all_riders' | 'all_restaurants' | 'all'
 *
 * Required Vercel env vars:
 *   FIREBASE_PROJECT_ID     e.g. manabites-f3664
 *   FIREBASE_CLIENT_EMAIL   from service account JSON
 *   FIREBASE_PRIVATE_KEY    from service account JSON (with literal \n newlines)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

// One-time Admin SDK initialization (Vercel reuses warm instances)
function ensureInit() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

const FIRESTORE_DB = 'manabites'; // named Firestore database

async function collectTokens(audience) {
  ensureInit();
  const db = getFirestore(FIRESTORE_DB);
  const tokens = new Set();

  const addTokensFrom = async (collectionName, tokenField = 'fcmToken') => {
    const snap = await db.collection(collectionName).get();
    snap.docs.forEach(d => {
      const t = d.data()[tokenField];
      if (t && typeof t === 'string' && t.length > 20) tokens.add(t);
    });
  };

  if (audience === 'all_customers' || audience === 'all') {
    await addTokensFrom('users');
  }
  if (audience === 'all_riders' || audience === 'all') {
    await addTokensFrom('riders');
  }
  if (audience === 'all_restaurants' || audience === 'all') {
    await addTokensFrom('restaurants');
  }

  return [...tokens];
}

export default async function handler(req, res) {
  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { title, message, audience } = req.body || {};
  if (!title || !message || !audience) {
    return res.status(400).json({ error: 'title, message and audience are required' });
  }

  // Verify env vars are set
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY) {
    return res.status(500).json({ error: 'Firebase Admin env vars not configured' });
  }

  try {
    const tokens = await collectTokens(audience);
    if (tokens.length === 0) {
      return res.json({ success: 0, failed: 0, total: 0, skipped: 'no tokens found' });
    }

    const messaging = getMessaging();
    const BATCH = 500; // FCM multicast limit
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < tokens.length; i += BATCH) {
      const batch = tokens.slice(i, i + BATCH);
      try {
        const result = await messaging.sendEachForMulticast({
          tokens: batch,
          notification: { title, body: message },
          data: { type: 'broadcast', title, message },
          android: {
            priority: 'high',
            notification: {
              sound:     'default',
              channelId: 'broadcast',
              icon:      'notification_icon',
            },
          },
          apns: {
            payload: { aps: { sound: 'default', badge: 1 } },
          },
          webpush: {
            notification: {
              icon:               '/icons/icon-192x192.png',
              badge:              '/icons/icon-72x72.png',
              requireInteraction: false,
            },
            fcmOptions: { link: '/' },
          },
        });
        successCount += result.successCount;
        failureCount += result.failureCount;
      } catch (batchErr) {
        console.error('FCM batch error:', batchErr.message);
        failureCount += batch.length;
      }
    }

    return res.json({ success: successCount, failed: failureCount, total: tokens.length });
  } catch (err) {
    console.error('send-fcm error:', err);
    return res.status(500).json({ error: err.message });
  }
}
