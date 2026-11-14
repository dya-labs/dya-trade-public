// DYA ID screens rendered in these stories use next/image with `unoptimized` (ID keeps vinext); Storybook has no Next runtime.
import type { ImgHTMLAttributes } from 'react';

export default function Image(props: ImgHTMLAttributes<HTMLImageElement> & { alt: string; unoptimized?: boolean; priority?: boolean }) {
  const attributes = { ...props };
  delete attributes.unoptimized;
  delete attributes.priority;
  return <img {...attributes} alt={props.alt} />;
}
