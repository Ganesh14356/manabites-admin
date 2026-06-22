/**
 * Vercel serverless function — Feature flag toggle
 *
 * POST /api/update-flags
 * Body: { key: string, value: boolean }
 *
 * Uses Firebase Admin SDK so it bypasses Firestore security rules.
 * Required Vercel env vars:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const FIRESTORE_DB = 'manabites';

function ensureInit() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId:   (process.env.FIREBASE_PROJECT_ID   || 'manabites-f3664').trim(),
      clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(),
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '')
        .replace(/^﻿/, '')
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim(),
    }),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { key, value } = req.body || {};
  if (typeof key !== 'string' || typeof value !== 'boolean') {
    return res.status(400).json({ error: 'Body must have { key: string, value: boolean }' });
  }

  try {
    ensureInit();
    const db = getFirestore(FIRESTORE_DB);
    const ref = db.collection('config').doc('verticals');
    await ref.set({ [key]: value, updated_at: FieldValue.serverTimestamp() }, { merge: true });
    return res.status(200).json({ ok: true, key, value });
  } catch (e) {
    console.error('[update-flags]', e);
    return res.status(500).json({ error: e.message || 'Internal error' });
  }
}
