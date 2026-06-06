import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export type AuditAction =
  | 'RIDER_CREATED'
  | 'RIDER_EDITED'
  | 'RIDER_APPROVED'
  | 'RIDER_REJECTED'
  | 'RIDER_SUSPENDED'
  | 'RIDER_ACTIVATED'
  | 'RIDER_DELETED'
  | 'RIDER_LOGIN_CREATED'
  | 'RIDER_BANK_VERIFIED'
  | 'RIDER_BANK_VERIFICATION_FAILED'
  | 'RIDER_DOCUMENT_VERIFIED';

interface LogAuditEventParams {
  action: AuditAction;
  entityType: string;
  entityId: string;
  entityName: string;
  adminUid: string | null | undefined;
  adminName: string | null | undefined;
  adminEmail: string | null | undefined;
  details?: Record<string, unknown>;
}

/**
 * Records an admin action to the `auditLogs` collection. Failures are swallowed —
 * an audit-trail write must never block or fail the primary action it documents
 * (mirrors the defensive pattern used for `bankVerificationLogs` in RestaurantManagement).
 */
export async function logAuditEvent(params: LogAuditEventParams): Promise<void> {
  try {
    await addDoc(collection(db, 'auditLogs'), {
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      entityName: params.entityName,
      adminUid: params.adminUid ?? null,
      adminName: params.adminName ?? null,
      adminEmail: params.adminEmail ?? null,
      details: params.details ?? {},
      timestamp: serverTimestamp(),
    });
  } catch (err: any) {
    console.error('[auditLog] failed to record event:', params.action, err?.code ?? err?.message);
  }
}
