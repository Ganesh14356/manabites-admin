interface OrderIdProps {
  id: string;
  displayOrderId?: string | null;
  orderNumber?: number | null;
  className?: string;
  prefixClass?: string;
  suffixClass?: string;
  showHash?: boolean;
}

/**
 * Shows MB-HAN-260626-9112 with last segment in brand color.
 * Priority: displayOrderId → orderNumber → Firestore doc ID fallback.
 */
export function OrderId({
  id,
  displayOrderId,
  orderNumber,
  className = '',
  prefixClass = 'text-gray-400',
  suffixClass = 'text-brand font-black',
  showHash = false,
}: OrderIdProps) {
  if (displayOrderId) {
    const lastDash = displayOrderId.lastIndexOf('-');
    const prefix   = lastDash !== -1 ? displayOrderId.slice(0, lastDash + 1) : '';
    const last     = lastDash !== -1 ? displayOrderId.slice(lastDash + 1)    : displayOrderId;
    return (
      <span className={`font-mono tracking-wide ${className}`}>
        {showHash && <span className={prefixClass}>#</span>}
        <span className={prefixClass}>{prefix}</span>
        <span className={suffixClass}>{last}</span>
      </span>
    );
  }

  if (orderNumber) {
    const str    = String(orderNumber);
    const prefix = str.slice(0, -2);
    const last2  = str.slice(-2);
    return (
      <span className={`font-mono tracking-wide ${className}`}>
        <span className={prefixClass}>#{prefix}</span>
        <span className={suffixClass}>{last2}</span>
      </span>
    );
  }

  const upper  = id.toUpperCase();
  const prefix = upper.length > 4 ? upper.slice(0, -4) : '';
  const last4  = upper.slice(-4);
  return (
    <span className={`font-mono tracking-wide ${className}`}>
      {showHash && <span className={prefixClass}>#</span>}
      {prefix && <span className={prefixClass}>{prefix}</span>}
      <span className={suffixClass}>{last4}</span>
    </span>
  );
}

export function fmtOrderId(id: string, displayOrderId?: string | null, orderNumber?: number | null): string {
  if (displayOrderId) return displayOrderId;
  if (orderNumber) return `#${orderNumber}`;
  return `#${id.toUpperCase()}`;
}
