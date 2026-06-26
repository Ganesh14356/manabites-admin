interface OrderIdProps {
  id: string;
  orderNumber?: number | null;
  className?: string;
  prefixClass?: string;
  suffixClass?: string;
  showHash?: boolean;
}

export function OrderId({
  id,
  orderNumber,
  className = '',
  prefixClass = 'text-gray-400',
  suffixClass = 'text-brand font-black',
  showHash = true,
}: OrderIdProps) {
  if (orderNumber) {
    const str   = String(orderNumber);
    const prefix = str.slice(0, -2);
    const last2  = str.slice(-2);
    return (
      <span className={`font-mono tracking-wide ${className}`}>
        {showHash && <span className={prefixClass}>#</span>}
        <span className={prefixClass}>{prefix}</span>
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

export function fmtOrderId(id: string, orderNumber?: number | null): string {
  if (orderNumber) return `#${orderNumber}`;
  return `#${id.slice(0, -4).toUpperCase()}${id.slice(-4).toUpperCase()}`;
}
