// DYA ID screens rendered in these stories use next/link (ID keeps vinext); Storybook has no Next runtime.
import type { AnchorHTMLAttributes } from 'react';

export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} />;
}
