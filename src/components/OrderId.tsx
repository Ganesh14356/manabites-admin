interface OrderIdProps {
  id: string;
  className?: string;
  prefixClass?: string;
  suffixClass?: string;
  showHash?: boolean;
}

export function OrderId({
  id,
  className = '',
  prefixClass = 'text-gray-400',
  suffixClass = 'text-brand font-black',
  showHash = true,
}: OrderIdProps) {
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

export function fmtOrderId(id: string): string {
  return `#${id.slice(0, -4).toUpperCase()}${id.slice(-4).toUpperCase()}`;
}
