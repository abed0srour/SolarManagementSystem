'use client';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import AnchoredPanel from './ui/anchored-panel';

export interface ComboboxOption {
  /** Stable identity, and what `value` holds for a multi-select. */
  value: string;
  label: string;
  sub?: string | null;
  /** Renders the label in monospace — right for serials and reference numbers. */
  mono?: boolean;
}

interface BaseProps {
  options: ComboboxOption[];
  /** Called as the user types; the caller owns fetching/filtering. */
  onSearch?: (query: string) => void;
  /** Called when the panel opens, so callers can fetch on demand. */
  onOpen?: () => void;
  placeholder?: string;
  label?: ReactNode;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  emptyText?: string;
}

interface SingleProps extends BaseProps {
  multiple?: false;
  value: ComboboxOption | null;
  onChange: (option: ComboboxOption | null) => void;
}

interface MultiProps extends BaseProps {
  multiple: true;
  value: string[];
  onChange: (values: string[]) => void;
  /** Caps the selection; the input hides once reached. */
  max?: number;
}

type Props = SingleProps | MultiProps;

/**
 * The one searchable picker in the app — single-select (a client, a product) or
 * multi-select with chips (serial numbers).
 *
 * Everything about *where* the list appears lives in AnchoredPanel, so the two
 * behaviours that used to be missing — flipping above the anchor near the
 * bottom of the screen, and turning into a bottom sheet on a phone — are gained
 * by every picker at once rather than being reimplemented per call site.
 */
export default function Combobox(props: Props) {
  const { options, onSearch, onOpen, placeholder, label, className, disabled, required, emptyText = '—' } = props;
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const multiple = props.multiple === true;
  const selectedValues = multiple ? props.value : props.value ? [props.value.value] : [];
  const full = multiple && props.max !== undefined && props.value.length >= props.max;

  // Chips already show what is picked, so keep the list to what is not.
  const visible = multiple ? options.filter((o) => !selectedValues.includes(o.value)) : options;

  useEffect(() => {
    setActive(0);
  }, [options.length, input]);

  const openPanel = () => {
    if (disabled || full) return;
    setOpen(true);
    onOpen?.();
  };

  const closePanel = () => {
    setOpen(false);
    setInput('');
  };

  const pick = (option: ComboboxOption) => {
    if (multiple) {
      const next = [...props.value, option.value];
      props.onChange(next);
      setInput('');
      onSearch?.('');
      if (props.max !== undefined && next.length >= props.max) setOpen(false);
      else inputRef.current?.focus();
    } else {
      props.onChange(option);
      closePanel();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      openPanel();
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (visible[active]) pick(visible[active]);
    } else if (e.key === 'Backspace' && !input && multiple && props.value.length) {
      props.onChange(props.value.slice(0, -1));
    }
  };

  const list = (
    <>
      {visible.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</div>}
      {visible.map((o, i) => {
        const selected = !multiple && selectedValues.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            dir={o.mono ? 'ltr' : undefined}
            // mousedown, not click: it fires before the input blurs and before a
            // dialog's outside-interaction handler can swallow the selection.
            onMouseDown={(e) => {
              e.preventDefault();
              pick(o);
            }}
            onMouseEnter={() => setActive(i)}
            className={cn(
              // min-h-11 keeps every row a comfortable touch target on a phone.
              'flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm sm:min-h-0 sm:py-1.5',
              i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
            )}
          >
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate', o.mono && 'font-mono text-xs')}>{o.label}</span>
              {o.sub && <span className="block truncate text-xs text-muted-foreground">{o.sub}</span>}
            </span>
            {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </button>
        );
      })}
    </>
  );

  // Single-select with a choice made: show it as a cleareable summary row.
  const selectedSingle = !multiple ? props.value : null;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div ref={anchorRef}>
        {selectedSingle ? (
          <div className="flex h-9 items-center justify-between gap-1 rounded-md border border-input bg-background px-3 text-sm">
            <span className="truncate">{selectedSingle.label}</span>
            <button
              type="button"
              aria-label="Clear"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => (props as SingleProps).onChange(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            {multiple && props.value.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {props.value.map((v) => (
                  <Badge key={v} variant="muted" className="gap-1 font-mono text-xs" dir="ltr">
                    {v}
                    <button
                      type="button"
                      aria-label={`Remove ${v}`}
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => props.onChange(props.value.filter((x) => x !== v))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            {!full && (
              <div className="relative">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={inputRef}
                  dir={multiple ? 'ltr' : undefined}
                  placeholder={placeholder}
                  value={input}
                  disabled={disabled}
                  required={required && selectedValues.length === 0}
                  onChange={(e) => {
                    setInput(e.target.value);
                    onSearch?.(e.target.value);
                    if (!open) openPanel();
                  }}
                  onFocus={openPanel}
                  onKeyDown={onKeyDown}
                  className="ps-8 pe-8"
                />
                <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
            )}
          </>
        )}
      </div>

      <AnchoredPanel anchorRef={anchorRef} open={open && !selectedSingle && !full} onClose={closePanel} label={label ?? placeholder}>
        {list}
      </AnchoredPanel>
    </div>
  );
}
