'use client';
import { ReactNode, RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

/** Matches Tailwind's `sm` breakpoint. */
const MOBILE_QUERY = '(max-width: 639px)';

export function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return mobile;
}

interface Placement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/** Never squeeze the list into a sliver; below this we flip instead. */
const MIN_PANEL_HEIGHT = 160;
const PREFERRED_PANEL_HEIGHT = 288;
const GAP = 4;
const VIEWPORT_MARGIN = 8;

function measure(anchor: HTMLElement): Placement {
  const r = anchor.getBoundingClientRect();
  const vHeight = typeof window !== 'undefined' && window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const vWidth = typeof window !== 'undefined' && window.visualViewport ? window.visualViewport.width : window.innerWidth;

  const spaceBelow = vHeight - r.bottom - GAP - VIEWPORT_MARGIN;
  const spaceAbove = r.top - GAP - VIEWPORT_MARGIN;

  // Prefer below, but flip above when below cannot show a usable list and above
  // is roomier. Whichever side wins, the height is clamped to what actually
  // fits, so the panel can never run off the edge of the screen.
  const flip = spaceBelow < MIN_PANEL_HEIGHT && spaceAbove > spaceBelow;
  const available = Math.max(MIN_PANEL_HEIGHT, flip ? spaceAbove : spaceBelow);
  const maxHeight = Math.min(PREFERRED_PANEL_HEIGHT, available);

  const maxAllowedWidth = Math.max(100, vWidth - 2 * VIEWPORT_MARGIN);
  const width = Math.min(Math.max(r.width, 220), maxAllowedWidth);
  const isRtl = typeof document !== 'undefined' && (document.documentElement.dir === 'rtl' || getComputedStyle(anchor).direction === 'rtl');
  const idealLeft = isRtl ? r.right - width : r.left;

  // Keep the panel inside the viewport horizontally too
  const left = Math.min(Math.max(VIEWPORT_MARGIN, idealLeft), Math.max(VIEWPORT_MARGIN, vWidth - width - VIEWPORT_MARGIN));

  return { top: flip ? Math.max(VIEWPORT_MARGIN, r.top - GAP - maxHeight) : r.bottom + GAP, left, width, maxHeight };
}

const same = (a: Placement | null, b: Placement) =>
  !!a && a.top === b.top && a.left === b.left && a.width === b.width && a.maxHeight === b.maxHeight;

/**
 * A floating panel tethered to an anchor element.
 *
 * Rendered in a body portal so it is never clipped by a dialog's or a table's
 * `overflow`, and positioned directly next to the anchor on both mobile and
 * desktop: it flips above the anchor when there is no room below and clamps its
 * height to the space that actually exists.
 */
export default function AnchoredPanel({
  anchorRef,
  open,
  onClose,
  children,
  className,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label?: ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const [placement, setPlacement] = useState<Placement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || isMobile) return;
    let frame = 0;
    // Re-measured every frame while open: a picker inside a dialog is often
    // opened while the dialog is still animating into place, so a single
    // measurement captures pre-layout coordinates. State only changes when the
    // numbers actually change, so this does not re-render every frame.
    const track = () => {
      const el = anchorRef.current;
      if (el) {
        const next = measure(el);
        setPlacement((prev) => (same(prev, next) ? prev : next));
      }
      frame = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(frame);
  }, [open, isMobile, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!anchorRef.current?.contains(t) && !panelRef.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // close the panel, not the dialog behind it
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  // On mobile devices, render in-flow directly beneath the search input so that
  // opening suggestions naturally moves following form fields down.
  if (isMobile) {
    return (
      <div
        ref={panelRef}
        data-entity-picker-list=""
        className={cn(
          'relative z-20 mt-1 flex w-full flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-sm animate-in fade-in-50 duration-150',
          className,
        )}
        style={{
          maxHeight: 280,
          pointerEvents: 'auto',
        }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">{children}</div>
      </div>
    );
  }

  if (typeof document === 'undefined' || !placement) return null;

  return createPortal(
    <div
      ref={panelRef}
      // Radix marks everything outside an open dialog `pointer-events: none`,
      // and dialog.tsx looks for this attribute to know a click in here is not
      // an "outside interaction" that should dismiss the dialog.
      data-entity-picker-list=""
      style={{
        position: 'fixed',
        top: placement.top,
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
        zIndex: 100,
        pointerEvents: 'auto',
      }}
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg',
        className,
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">{children}</div>
    </div>,
    document.body,
  );
}
