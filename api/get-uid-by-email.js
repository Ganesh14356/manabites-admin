/**
 * POST /api/get-uid-by-email
 * Body: { email: string }
 * Returns: { uid: string } or 404 if not found
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function ensureInit() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId:   (process.env.FIREBASE_PROJECT_ID   || '').trim(),
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

  const { email } = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  if (!email) return res.status(400).json({ error: 'email required' });

  try {
    ensureInit();
    const auth = getAuth();
    const user = await auth.getUserByEmail(email.trim().toLowerCase());
    return res.status(200).json({ uid: user.uid, email: user.email });
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.status(500).json({ error: e.message });
  }
}
