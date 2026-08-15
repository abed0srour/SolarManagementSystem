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
  const spaceBelow = window.innerHeight - r.bottom - GAP - VIEWPORT_MARGIN;
  const spaceAbove = r.top - GAP - VIEWPORT_MARGIN;

  // Prefer below, but flip above when below cannot show a usable list and above
  // is roomier. Whichever side wins, the height is clamped to what actually
  // fits, so the panel can never run off the edge of the screen.
  const flip = spaceBelow < MIN_PANEL_HEIGHT && spaceAbove > spaceBelow;
  const available = Math.max(MIN_PANEL_HEIGHT, flip ? spaceAbove : spaceBelow);
  const maxHeight = Math.min(PREFERRED_PANEL_HEIGHT, available);

  const width = Math.max(r.width, 220);
  // Keep the panel inside the viewport horizontally too — a right-aligned
  // anchor in a narrow window would otherwise overflow.
  const left = Math.min(Math.max(VIEWPORT_MARGIN, r.left), Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN));

  return { top: flip ? r.top - GAP - maxHeight : r.bottom + GAP, left, width, maxHeight };
}

const same = (a: Placement | null, b: Placement) =>
  !!a && a.top === b.top && a.left === b.left && a.width === b.width && a.maxHeight === b.maxHeight;

/**
 * A floating panel tethered to an anchor element.
 *
 * Rendered in a body portal so it is never clipped by a dialog's or a table's
 * `overflow`, and positioned so it is never clipped by the viewport either: it
 * flips above the anchor when there is no room below and clamps its height to
 * the space that actually exists. The previous hand-rolled versions of this
 * pinned the list to `anchor.bottom + 4` with a fixed `max-height`, which is
 * why a picker near the bottom of the screen ran off the edge.
 *
 * On phones it stops being a dropdown altogether and becomes a bottom sheet —
 * a 200px-wide list anchored to a cramped input is unusable on a touch screen.
 */
export default function AnchoredPanel({
  anchorRef,
  open,
  onClose,
  children,
  label,
  className,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Sheet heading, shown on mobile only, where the field label scrolls away. */
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

  if (!open || typeof document === 'undefined') return null;
  if (!isMobile && !placement) return null;

  const panel = (
    <div
      ref={panelRef}
      // Radix marks everything outside an open dialog `pointer-events: none`,
      // and dialog.tsx looks for this attribute to know a click in here is not
      // an "outside interaction" that should dismiss the dialog.
      data-entity-picker-list=""
      style={
        isMobile
          ? { position: 'fixed', insetInline: 8, bottom: 8, zIndex: 100, pointerEvents: 'auto' }
          : {
              position: 'fixed',
              top: placement!.top,
              left: placement!.left,
              width: placement!.width,
              maxHeight: placement!.maxHeight,
              zIndex: 100,
              pointerEvents: 'auto',
            }
      }
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border bg-popover shadow-lg',
        isMobile && 'max-h-[70vh] rounded-xl',
        className,
      )}
    >
      {isMobile && label && (
        <div className="shrink-0 border-b px-4 py-3 text-sm font-semibold">{label}</div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">{children}</div>
    </div>
  );

  return createPortal(
    <>
      {/* Dimmer only on the sheet, so the desktop dropdown stays lightweight. */}
      {isMobile && (
        <div
          data-entity-picker-list=""
          style={{ position: 'fixed', inset: 0, zIndex: 99, pointerEvents: 'auto' }}
          className="bg-black/40"
          onMouseDown={onClose}
        />
      )}
      {panel}
    </>,
    document.body,
  );
}
