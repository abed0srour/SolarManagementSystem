'use client';
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = 'DialogOverlay';

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { wide?: boolean }
>(({ className, children, wide, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      // Entity-picker dropdowns render in a body portal (outside this content),
      // so clicking them must not count as an outside interaction that would
      // dismiss the dialog or swallow the selection.
      onInteractOutside={(e) => {
        if ((e.target as HTMLElement)?.closest?.('[data-entity-picker-list]')) e.preventDefault();
      }}
      onPointerDownOutside={(e) => {
        if ((e.target as HTMLElement)?.closest?.('[data-entity-picker-list]')) e.preventDefault();
      }}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-1.5rem)] sm:w-full translate-x-[-50%] translate-y-[-50%] gap-4 border bg-card p-4 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:p-5 rounded-xl sm:rounded-lg',
        // Taller on a phone, where 8vh of dimmed backdrop is wasted space and
        // forms are stacked into one long column.
        'max-h-[96vh] overflow-y-auto sm:max-h-[92vh]',
        wide ? 'max-w-4xl' : 'max-w-lg',
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = 'DialogContent';

/*
 * Header and footer stick to the edges of the scrolling content, so on a long
 * form the title stays readable and Save/Cancel stay reachable without
 * scrolling to the bottom. The negative margins let their backgrounds span the
 * dialog's full width despite its p-5 padding.
 */
const DialogHeader = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'sticky top-0 z-20 -mx-4 -mt-4 flex flex-col space-y-1.5 border-b bg-card px-4 pb-3 pe-12 pt-4 text-start sm:-mx-5 sm:-mt-5 sm:px-5 sm:pt-5',
      className,
    )}
    {...props}
  >
    {children}
    {/* Lives in the header so it stays put while the body scrolls. */}
    <DialogPrimitive.Close className="absolute end-4 top-4 rounded-sm p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:outline-none">
      <X className="h-4 w-4" />
      <span className="sr-only">Close</span>
    </DialogPrimitive.Close>
  </div>
);
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'sticky bottom-0 z-20 -mx-4 -mb-4 flex flex-col-reverse gap-2 border-t bg-card px-4 pb-4 pt-3 sm:-mx-5 sm:-mb-5 sm:flex-row sm:justify-end sm:px-5 sm:pb-5',
      className,
    )}
    {...props}
  />
);

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props} />
));
DialogTitle.displayName = 'DialogTitle';

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
DialogDescription.displayName = 'DialogDescription';

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
