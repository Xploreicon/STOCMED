import Link from 'next/link';

// Brand logo mark — tilted split pill inside a rounded square (matches /design-reference)
export function LogoMark({ size = 32, onDark = false }: { size?: number; onDark?: boolean }) {
  const box = onDark ? '#FFFFFF' : '#0066CC';
  const bar = onDark ? '#0066CC' : '#FFFFFF';
  return (
    <div
      className="flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, borderRadius: 8, background: box }}
    >
      <div
        style={{
          width: size * 0.56,
          height: size * 0.28,
          borderRadius: size * 0.14,
          transform: 'rotate(45deg)',
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: '50%', height: '100%', background: bar }} />
        <div style={{ width: '50%', height: '100%', background: bar, opacity: 0.55, borderLeft: `1px solid ${box}` }} />
      </div>
    </div>
  );
}

export function Logo({
  size = 32,
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
        className={`font-medium tracking-[-0.2px] ${onDark ? 'text-white' : 'text-ink'}`}
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
    <Link href={href} className={`flex items-center gap-2 w-fit ${className}`}>
      {content}
    </Link>
  );
}
