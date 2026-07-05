'use client';

import { useEffect, useRef, type ReactNode } from 'react';

interface ScrollFadeInProps {
  children: ReactNode;
  className?: string;
  /** Delay in ms before the animation triggers after entering viewport */
  delay?: number;
}

export default function ScrollFadeIn({ children, className = '', delay = 0 }: ScrollFadeInProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (delay > 0) {
            setTimeout(() => el.classList.add('is-visible'), delay);
          } else {
            el.classList.add('is-visible');
          }
          observer.unobserve(el);
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div ref={ref} className={`animate-fade-up ${className}`}>
      {children}
    </div>
  );
}
