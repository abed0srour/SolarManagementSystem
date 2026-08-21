'use client';
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Maximum rapid clicks allowed within the click window before lockout. Defaults to 5. */
  maxClicks?: number;
  /** Rolling time window in ms to count clicks. Defaults to 3000ms. */
  clickWindowMs?: number;
  /** Lockout duration in ms after reaching maxClicks. Defaults to 3000ms. */
  lockoutDurationMs?: number;
  /** Automatically block double clicks while an async onClick Promise is pending. Defaults to true. */
  preventDoubleSubmit?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      disabled,
      onClick,
      maxClicks = 5,
      clickWindowMs = 3000,
      lockoutDurationMs = 3000,
      preventDoubleSubmit = true,
      children,
      ...props
    },
    ref,
  ) => {
    const [isPending, setIsPending] = React.useState(false);
    const [isLocked, setIsLocked] = React.useState(false);
    const clickTimestampsRef = React.useRef<number[]>([]);
    const lockoutTimerRef = React.useRef<NodeJS.Timeout | null>(null);

    React.useEffect(() => {
      return () => {
        if (lockoutTimerRef.current) clearTimeout(lockoutTimerRef.current);
      };
    }, []);

    const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled || isLocked || (preventDoubleSubmit && isPending)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const now = Date.now();
      // Keep only clicks within rolling window
      const recentClicks = clickTimestampsRef.current.filter((ts) => now - ts < clickWindowMs);
      recentClicks.push(now);
      clickTimestampsRef.current = recentClicks;

      if (recentClicks.length >= maxClicks) {
        setIsLocked(true);
        if (lockoutTimerRef.current) clearTimeout(lockoutTimerRef.current);
        lockoutTimerRef.current = setTimeout(() => {
          setIsLocked(false);
          clickTimestampsRef.current = [];
        }, lockoutDurationMs);

        // If clicks strictly exceed maxClicks, block this click execution
        if (recentClicks.length > maxClicks) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      if (onClick) {
        try {
          const result: any = onClick(e);
          if (preventDoubleSubmit && result && typeof result.then === 'function') {
            setIsPending(true);
            await result;
          }
        } finally {
          setIsPending(false);
        }
      }
    };

    const isDisabled = disabled || isLocked || (preventDoubleSubmit && isPending);

    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={isDisabled}
        onClick={handleClick}
        {...props}
      >
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
