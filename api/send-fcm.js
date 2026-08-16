/**
 * Vercel serverless function — Firebase Cloud Messaging broadcast
 *
 * POST /api/send-fcm
 * Body: { title, message, audience }
 * audience: 'all_customers' | 'all_riders' | 'all_restaurants' | 'all'
 *
 * Required Vercel env vars:
 *   FIREBASE_PROJECT_ID     e.g. manabites2-6538e
 *   FIREBASE_CLIENT_EMAIL   from service account JSON
 *   FIREBASE_PRIVATE_KEY    from service account JSON (with literal \n newlines)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

function ensureInit() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId:   (process.env.FIREBASE_PROJECT_ID   || '').trim(),
      clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(),
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY  || '')
        .replace(/^﻿/, '').replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').trim(),
    }),
  });
}

const FIRESTORE_DB = '(default)';

async function collectTokens(audience) {
  ensureInit();
  const db = getFirestore(FIRESTORE_DB);
  const tokens = new Set();

  if (audience === 'all_customers' || audience === 'all') {
    const snap = await db.collection('users').get();
    snap.docs.forEach(d => {
      const data = d.data();
      // customers store token at fcmToken or settings.fcmToken
      const t = data.fcmToken || data.settings?.fcmToken;
      if (t && typeof t === 'string' && t.length > 20) tokens.add(t);
    });
  }

  if (audience === 'all_riders' || audience === 'all') {
    const snap = await db.collection('riders').get();
    snap.docs.forEach(d => {
      const data = d.data();
      const t = data.fcmToken;
      if (t && typeof t === 'string' && t.length > 20) tokens.add(t);
    });
  }

  if (audience === 'all_restaurants' || audience === 'all') {
    const snap = await db.collection('restaurants').get();
    snap.docs.forEach(d => {
      const data = d.data();
      // restaurants may have single fcmToken or array fcmTokens
      if (data.fcmToken && typeof data.fcmToken === 'string' && data.fcmToken.length > 20) {
        tokens.add(data.fcmToken);
      }
      if (Array.isArray(data.fcmTokens)) {
        data.fcmTokens.forEach(t => {
          if (t && typeof t === 'string' && t.length > 20) tokens.add(t);
        });
      }
    });
  }

  return [...tokens];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { title, message, audience } = req.body || {};
  if (!title || !message || !audience) {
    return res.status(400).json({ error: 'title, message and audience are required' });
  }

  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
    console.error('send-fcm: missing Firebase Admin env vars');
    return res.status(500).json({ error: 'Firebase Admin env vars not configured on Vercel' });
  }

  try {
    const tokens = await collectTokens(audience);
    if (tokens.length === 0) {
      return res.json({ success: 0, failed: 0, total: 0, skipped: 'no FCM tokens found in DB' });
    }

    const messaging = getMessaging();
    const BATCH = 500;
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
              priority:  'max',
            },
          },
          apns: {
            payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } },
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

        // Log failed tokens for debugging
        result.responses.forEach((r, idx) => {
          if (!r.success) {
            console.error(`FCM token[${i + idx}] failed:`, r.error?.message);
          }
        });
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
