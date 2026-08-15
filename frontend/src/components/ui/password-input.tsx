'use client';
import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Input } from './input';

/**
 * Password field with a reveal toggle.
 *
 * Typing a password you cannot see is the main reason people mistype one twice
 * and get locked into a confusing "passwords do not match" loop, so the toggle
 * is offered everywhere a password is entered. It defaults to hidden and never
 * persists the revealed state.
 */
const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>
>(({ className, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        // Room for the button, and always LTR: a password is not prose, and in
        // Arabic an RTL password box puts the caret on the wrong side.
        dir="ltr"
        className={cn('pe-10', className)}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';

export { PasswordInput };
