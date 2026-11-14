import type { ComponentProps } from 'react';

/** Remix RiShieldFill geometry with the shared DYA diamond accent. */
export function PrivacyIcon({ accent = 'var(--primary)', ...props }: ComponentProps<'svg'> & { accent?: string }) {
  return <svg viewBox="0 0 24 24" width={24} height={24} fill="currentColor" aria-hidden="true" {...props}>
    <path d="M3.78307 2.82598L12 1L20.2169 2.82598C20.6745 2.92766 21 3.33347 21 3.80217V13.7889C21 15.795 19.9974 17.6684 18.3282 18.7812L12 23L5.6718 18.7812C4.00261 17.6684 3 15.795 3 13.7889V3.80217C3 3.33347 3.32553 2.92766 3.78307 2.82598Z" />
    <path d="M12 8L16 12L12 16L8 12Z" fill={accent} />
  </svg>;
}
