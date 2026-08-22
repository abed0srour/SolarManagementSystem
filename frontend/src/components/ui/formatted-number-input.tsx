'use client';
import * as React from 'react';
import { cn } from '../../lib/utils';

export interface FormattedNumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value?: string | number | null;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onValueChange?: (value: string, numericValue: number) => void;
  allowDecimals?: boolean;
  maxDecimals?: number;
  allowNegative?: boolean;
}

/** Formats a clean raw numeric string or number (e.g. "1234567.89") to "1,234,567.89" */
export function formatThousands(
  value: string | number | null | undefined,
  allowDecimals = true,
  maxDecimals = 6,
): string {
  if (value === null || value === undefined || value === '') return '';
  const str = String(value);
  if (str === '-') return '-';

  const isNeg = str.startsWith('-');
  const cleanStr = isNeg ? str.slice(1) : str;

  const parts = cleanStr.split('.');
  const intPart = parts[0] ? parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';

  if (parts.length > 1 && allowDecimals) {
    const decPart = maxDecimals !== undefined ? parts[1].slice(0, maxDecimals) : parts[1];
    return `${isNeg ? '-' : ''}${intPart}.${decPart}`;
  }

  // Preserve trailing dot if user just typed it
  if (cleanStr.endsWith('.') && allowDecimals) {
    return `${isNeg ? '-' : ''}${intPart}.`;
  }

  return `${isNeg ? '-' : ''}${intPart}`;
}

/** Strips commas and non-numeric characters from a formatted string */
export function parseFormattedNumber(
  value: string,
  allowDecimals = true,
  maxDecimals = 6,
  allowNegative = false,
): string {
  if (!value) return '';
  let clean = value.replace(/,/g, '');

  const isNegative = allowNegative && clean.startsWith('-');
  clean = clean.replace(/[^0-9.]/g, '');

  const parts = clean.split('.');
  let intPart = parts[0] || '';

  // Avoid leading multiple zeros like "00" unless it's "0"
  if (intPart.length > 1 && intPart.startsWith('0') && !intPart.startsWith('0.')) {
    intPart = intPart.replace(/^0+/, '') || '0';
  }

  let decPart = '';
  if (parts.length > 1 && allowDecimals) {
    const remaining = parts.slice(1).join('');
    decPart = '.' + (maxDecimals !== undefined ? remaining.slice(0, maxDecimals) : remaining);
  } else if (clean.endsWith('.') && allowDecimals && !clean.slice(0, -1).includes('.')) {
    decPart = '.';
  }

  return (isNegative ? '-' : '') + intPart + decPart;
}

/**
 * Reusable input for currencies, prices, and amounts that automatically formats
 * numbers with thousands comma separators in real time while typing, smoothly
 * preserving cursor positions and providing raw numeric values in onChange.
 */
export const FormattedNumberInput = React.forwardRef<HTMLInputElement, FormattedNumberInputProps>(
  (
    {
      value,
      onChange,
      onValueChange,
      allowDecimals = true,
      maxDecimals = 4,
      allowNegative = false,
      className,
      placeholder,
      disabled,
      onKeyDown,
      dir = 'ltr',
      inputMode = 'decimal',
      ...props
    },
    ref,
  ) => {
    const internalRef = React.useRef<HTMLInputElement | null>(null);

    // Merge external ref with internalRef
    React.useImperativeHandle(ref, () => internalRef.current as HTMLInputElement);

    const displayValue = React.useMemo(() => {
      return formatThousands(value, allowDecimals, maxDecimals);
    }, [value, allowDecimals, maxDecimals]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawInput = e.target.value;
      const oldCursorPos = e.target.selectionStart ?? rawInput.length;

      // Count non-comma characters before the cursor
      const textBeforeCursor = rawInput.slice(0, oldCursorPos);
      const nonCommasBeforeCursor = textBeforeCursor.replace(/,/g, '').length;

      // Sanitize to clean raw value
      const cleanRaw = parseFormattedNumber(rawInput, allowDecimals, maxDecimals, allowNegative);
      const newFormatted = formatThousands(cleanRaw, allowDecimals, maxDecimals);

      // Compute new cursor position in newFormatted
      let newCursorPos = newFormatted.length;
      let nonCommaCount = 0;
      for (let i = 0; i < newFormatted.length; i++) {
        if (nonCommaCount === nonCommasBeforeCursor) {
          newCursorPos = i;
          break;
        }
        if (newFormatted[i] !== ',') {
          nonCommaCount++;
        }
        if (nonCommaCount === nonCommasBeforeCursor) {
          newCursorPos = i + 1;
          break;
        }
      }

      // Create synthetic event with clean unformatted value
      const targetCopy = e.target;
      const syntheticEvent = {
        ...e,
        target: {
          ...targetCopy,
          value: cleanRaw,
          name: targetCopy.name,
        },
        currentTarget: {
          ...e.currentTarget,
          value: cleanRaw,
          name: e.currentTarget.name,
        },
      } as React.ChangeEvent<HTMLInputElement>;

      onChange?.(syntheticEvent);
      onValueChange?.(cleanRaw, Number(cleanRaw) || 0);

      // Restore cursor position on next animation frame
      requestAnimationFrame(() => {
        if (internalRef.current) {
          internalRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(e);
      if (e.key === 'Backspace') {
        const input = internalRef.current;
        if (!input) return;
        const { selectionStart, selectionEnd } = input;
        if (selectionStart === selectionEnd && selectionStart && selectionStart > 1) {
          // If the character to the left of cursor is a comma, delete the digit before the comma
          if (input.value[selectionStart - 1] === ',') {
            e.preventDefault();
            const newVal = input.value.slice(0, selectionStart - 2) + input.value.slice(selectionStart);
            const clean = parseFormattedNumber(newVal, allowDecimals, maxDecimals, allowNegative);

            const syntheticEvent = {
              target: { value: clean, name: input.name },
              currentTarget: { value: clean, name: input.name },
            } as unknown as React.ChangeEvent<HTMLInputElement>;

            onChange?.(syntheticEvent);
            onValueChange?.(clean, Number(clean) || 0);

            const newPos = selectionStart - 2;
            requestAnimationFrame(() => {
              if (internalRef.current) {
                internalRef.current.setSelectionRange(newPos, newPos);
              }
            });
          }
        }
      }
    };

    return (
      <input
        ref={internalRef}
        type="text"
        dir={dir}
        inputMode={inputMode}
        value={displayValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 tabular-nums',
          className,
        )}
        {...props}
      />
    );
  },
);

FormattedNumberInput.displayName = 'FormattedNumberInput';
export const CurrencyInput = FormattedNumberInput;
export default FormattedNumberInput;
