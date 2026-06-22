import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export type AuditAction =
  // Rider actions
  | 'RIDER_CREATED' | 'RIDER_EDITED' | 'RIDER_APPROVED' | 'RIDER_REJECTED'
  | 'RIDER_SUSPENDED' | 'RIDER_ACTIVATED' | 'RIDER_DELETED'
  | 'RIDER_LOGIN_CREATED' | 'RIDER_BANK_VERIFIED'
  | 'RIDER_BANK_VERIFICATION_FAILED' | 'RIDER_DOCUMENT_VERIFIED'
  // Sub-admin actions
  | 'SUBADMIN_CREATED' | 'SUBADMIN_EDITED' | 'SUBADMIN_SUSPENDED'
  | 'SUBADMIN_ACTIVATED' | 'SUBADMIN_DELETED' | 'SUBADMIN_PASSWORD_RESET'
  | 'SUBADMIN_PERMISSIONS_CHANGED'
  // Restaurant actions
  | 'RESTAURANT_APPROVED' | 'RESTAURANT_REJECTED' | 'RESTAURANT_SUSPENDED'
  // Order/finance actions
  | 'REFUND_PROCESSED' | 'PAYOUT_RELEASED' | 'COMMISSION_CHANGED'
  // Auth actions
  | 'ADMIN_LOGIN' | 'ADMIN_LOGOUT';

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
      userAgent: navigator.userAgent,
    });
  } catch (err: any) {
    console.error('[auditLog] failed:', params.action, err?.code ?? err?.message);
  }
}
