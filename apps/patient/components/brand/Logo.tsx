import Link from 'next/link';

// The two overlapping capsules from the StocMed wordmark.
export function LogoMark({ size = 36, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" className="shrink-0">
      <g transform="rotate(-32 22 20)">
        <rect x="3" y="10" width="36" height="18" rx="9" fill={onDark ? '#FFFFFF' : '#E4E7EC'} />
        <path d="M21 10h9a9 9 0 0 1 0 18h-9V10Z" fill={onDark ? '#C3CFF1' : '#4C70D6'} />
        <path d="M9 14h10" stroke={onDark ? '#ECEFFA' : '#FFFFFF'} strokeWidth="3" strokeLinecap="round" />
      </g>
      <rect x="13" y="25" width="33" height="17" rx="8.5" fill={onDark ? '#ECEFFA' : '#E4E7EC'} />
      <path d="M29 25h8.5a8.5 8.5 0 0 1 0 17H29V25Z" fill={onDark ? '#FFFFFF' : '#4C70D6'} />
      <path d="M19 29h8" stroke={onDark ? '#FFFFFF' : '#FAFAFA'} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({
  size = 36,
  wordSize = 18,
  onDark = false,
  href = '/',
  className = '',
}: {
  size?: number;
  wordSize?: number;
  onDark?: boolean;
  href?: string | null;
  className?: string;
}) {
  const content = (
    <>
      <LogoMark size={size} onDark={onDark} />
      <span
        className={`whitespace-nowrap font-bold tracking-tight ${onDark ? 'text-white' : 'text-primary'}`}
        style={{ fontSize: wordSize }}
      >
        StocMed
      </span>
    </>
  );
  if (href === null) {
    return <div className={`flex items-center gap-2 ${className}`}>{content}</div>;
  }
  return (
    <Link href={href} aria-label="StocMed" className={`flex items-center gap-2 w-fit ${className}`}>
      {content}
    </Link>
  );
}
