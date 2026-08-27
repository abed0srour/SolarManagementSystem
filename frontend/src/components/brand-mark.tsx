import Image from 'next/image';
import icon from '../app/icon.png';
import { cn } from '../lib/utils';

/**
 * The product's mark, as shown in the browser tab.
 *
 * The sign-in screens used to draw a sun glyph, which said the system was for
 * solar installers. It is not — it runs stores of any kind — so the mark is the
 * same icon the tab shows, in one component rather than redrawn at each of the
 * four places it appears.
 */
export default function BrandMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <Image
      src={icon}
      alt=""
      width={size}
      height={size}
      // Decorative: the product name is always rendered next to it, so a screen
      // reader announcing the file as well would only repeat itself.
      aria-hidden
      priority
      className={cn('shrink-0 rounded-xl', className)}
    />
  );
}
