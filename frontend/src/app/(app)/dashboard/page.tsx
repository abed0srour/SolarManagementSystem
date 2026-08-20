'use client';
import {
  ChevronLeft, ChevronRight, CalendarDays, ArrowUp, ArrowDown, Minus,
  Sparkles, Layers, TrendingUp, Package, Clock, ArrowRight, ShieldCheck, Zap,
  Sun, HandCoins, CreditCard, BarChart3, Table2, RefreshCw,
} from 'lucide-react';
import { ElementType, ReactNode, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, PieChart, Pie, Cell, ComposedChart, Line
} from 'recharts';
import { api, fmtMoney, fmtDate } from '../../../lib/api';
import { getUser } from '../../../lib/auth';
import { useLocalFirstData } from '../../../lib/use-local-storage-cache';
import { cn } from '../../../lib/utils';
import { seriesColors, statusColors, chartInk } from '../../../lib/charts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Skeleton } from '../../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import StatusChip from '../../../components/status-chip';

/**
 * Period-over-period change indicator.
 */
function Trend({ pct, goodWhenUp = true }: { pct: number | null | undefined; goodWhenUp?: boolean }) {
  if (pct === null || pct === undefined) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const flat = Math.abs(pct) < 0.05;
  const up = pct > 0;
  const good = flat ? null : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums',
        good === null && 'bg-muted text-muted-foreground',
        good === true && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
        good === false && 'bg-red-500/15 text-red-600 dark:text-red-400',
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {flat ? '0%' : `${up ? '+' : ''}${pct.toFixed(1)}%`}
    </span>
  );
}

/**
 * Micro sparkline for KPI tiles.
 */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return <div className="h-8" />;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = 100 / (points.length - 1);
  const d = points.map((p, i) => `${i * step},${28 - ((p - min) / span) * 24}`).join(' ');
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-7 w-full overflow-visible" aria-hidden="true">
      <polyline points={d} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
 * Analytics Pro primitives.
 *
 * Every mark on the pro view follows one spec: thin bars with a rounded
 * data-end, 2px lines, a solid hairline grid, and a 2px gap in the surface
 * colour doing the separating rather than a stroke drawn around the mark.
 * Series colour comes from the validated palette in `lib/charts` and never
 * from `--primary`: the accent is user-swappable chrome, so binding data to it
 * would repaint the meaning of a chart every time someone changes theme.
 * ------------------------------------------------------------------------- */

/** Axis ticks and dense cells: 940 / 12.9K / 4.2M. Never a headline figure. */
function compact(n: number): string {
  // A trailing ".0" is noise on an axis — 4K reads, 4.0K just takes room.
  const trim = (v: number, digits: number) => String(Number(v.toFixed(digits)));
  const v = Math.abs(n);
  if (v >= 1_000_000) return `${trim(n / 1_000_000, v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${trim(n / 1_000, v >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Clean y-axis ticks. Left to itself recharts fits the domain to the data and
 * lands on labels like 950 and 2.9K; an axis is the reference a reader does
 * arithmetic against, so it gets round numbers or it is not earning its space.
 */
function niceTicks(max: number, count = 5): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  return Array.from({ length: count }, (_, i) => i * step);
}

/** The one micro-label style every tile and card header on the pro view uses. */
function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground', className)}>
      {children}
    </div>
  );
}

/**
 * Chart tooltip drawn on the popover surface instead of recharts' hard-coded
 * white box, so it inherits both themes and the accent for free.
 */
function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: {
    dataKey?: string | number;
    name?: string;
    value?: number;
    color?: string;
    payload?: { full?: string };
  }[];
  label?: string;
  format?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  // The x-axis tick is abbreviated to fit ("14", "Mar"); the tooltip has room
  // for the point's full date, which the series carries alongside it.
  const heading = payload[0]?.payload?.full ?? label;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg">
      {heading && <div className="mb-1.5 font-semibold text-popover-foreground">{heading}</div>}
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={String(p.dataKey)} className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
              {p.name}
            </span>
            <span className="ms-auto font-semibold tabular-nums text-popover-foreground">
              {format ? format(Number(p.value ?? 0)) : p.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A swatch + name pair. Identity never rests on colour alone. */
function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

/**
 * The two-bar footer under each metric tile: this period over the one before
 * it, on a shared scale. It draws the same fact the delta chip states as a
 * percentage, so the reader sees the size of the base that percentage is
 * measured against — +300% off a near-empty week stops looking like a triumph.
 */
function CompareBars({ current, previous, color }: { current: number; previous: number; color: string }) {
  const max = Math.max(Math.abs(current), Math.abs(previous));
  const width = (v: number) => (max <= 0 ? '0%' : `${Math.max(1.5, (Math.abs(v) / max) * 100)}%`);
  return (
    <div className="mt-3 flex flex-col gap-[3px]" aria-hidden="true">
      <div className="h-1.5 w-full rounded-full bg-muted/50">
        <div className="h-full rounded-full" style={{ width: width(current), backgroundColor: color }} />
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted/50">
        <div className="h-full rounded-full bg-muted-foreground/30" style={{ width: width(previous) }} />
      </div>
    </div>
  );
}

/**
 * A metric tile: label, value, delta against a *named* period, compare bars.
 * The value uses proportional figures — `tabular-nums` gives every digit the
 * width of a zero, which leaves a headline number looking loose.
 */
function MetricTile({
  label,
  value,
  pct,
  goodWhenUp = true,
  current,
  previous,
  previousLabel,
  previousValue,
  color,
}: {
  label: string;
  value: string;
  pct?: number | null;
  goodWhenUp?: boolean;
  current: number;
  previous: number;
  previousLabel: string;
  previousValue: string;
  color: string;
}) {
  return (
    <Card className="border-border/60 shadow-none transition-colors hover:border-border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <Eyebrow className="truncate">{label}</Eyebrow>
          <Trend pct={pct} goodWhenUp={goodWhenUp} />
        </div>
        <div className="mt-2.5 truncate text-[26px] font-semibold leading-none tracking-tight">{value}</div>
        <div className="mt-2 flex items-baseline gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0">{previousLabel}</span>
          <span className="truncate font-medium text-foreground/70">{previousValue}</span>
        </div>
        <CompareBars current={current} previous={previous} color={color} />
      </CardContent>
    </Card>
  );
}

/**
 * Part-to-whole meter. The segments touch, so a 2px gap in the surface colour
 * separates them — a stroke around each fill would add ink that is not data.
 * Two shares would make a bad pie; as one track they read at a glance and stay
 * directly labelled underneath, so no value is gated behind a hover.
 */
function Meter({ segments }: { segments: { key: string; label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  return (
    <div>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted/60">
        {total > 0 &&
          segments.map((s) => (
            <div
              key={s.key}
              className="h-full rounded-full"
              style={{ width: `${(Math.max(0, s.value) / total) * 100}%`, backgroundColor: s.color }}
            />
          ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {segments.map((s) => (
          <div key={s.key} className="min-w-0">
            <LegendKey color={s.color} label={s.label} />
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="truncate text-sm font-semibold tabular-nums">{fmtMoney(s.value)}</span>
              {total > 0 && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {Math.round((Math.max(0, s.value) / total) * 100)}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One cell of the operations strip: a live figure with somewhere to go. */
function OpsCell({
  icon: Icon,
  label,
  value,
  tone = 'default',
  onClick,
}: {
  icon: ElementType;
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'warning' | 'critical';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-full w-full items-center gap-3 p-3.5 text-start transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            'block truncate text-base font-semibold tabular-nums',
            tone === 'good' && 'text-emerald-600 dark:text-emerald-400',
            tone === 'warning' && 'text-amber-600 dark:text-amber-400',
            tone === 'critical' && 'text-red-600 dark:text-red-400',
          )}
        >
          {value}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-transparent transition-colors group-hover:text-muted-foreground rtl:rotate-180" />
    </button>
  );
}

/**
 * A ranked bar list. Drawn in HTML rather than as a chart so the label, the
 * bar and the exact value share one row and no text can be clipped by its own
 * mark — which also makes it its own table view.
 */
function RankedBars({
  rows,
  color,
  empty,
}: {
  rows: { key: string; label: string; value: number; caption?: string }[];
  color: string;
  empty: string;
}) {
  if (rows.length === 0) {
    return <div className="py-10 text-center text-sm text-muted-foreground">{empty}</div>;
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-foreground">{r.label}</span>
            <span className="shrink-0 text-sm font-semibold tabular-nums">{fmtMoney(r.value)}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-muted/50">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(1.5, (Math.abs(r.value) / max) * 100)}%`, backgroundColor: color }}
              />
            </div>
            {r.caption && (
              <span className="w-11 shrink-0 text-end text-[11px] tabular-nums text-muted-foreground">{r.caption}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** `label` is the abbreviated axis tick; `full` is what the tooltip and the table row show. */
type TrendPoint = { key: string; label: string; full: string; total: number; collected: number; count: number };

/**
 * Turns the sparse `salesByDay` rows into a continuous series.
 *
 * The API only emits days that actually carried an invoice, in map-insertion
 * order, so plotting it raw both skips the quiet days and can run the x-axis
 * backwards. A month is filled day by day — a day with no sales is a zero, not
 * a gap — and a year is rolled up to twelve months, because 365 columns is not
 * a trend anyone can read.
 */
function buildTrend(
  rows: { date: string; total: number; collected?: number; count?: number }[],
  gran: Granularity,
  from: string,
  to: string,
): TrendPoint[] {
  const bucketed = new Map<string, { total: number; collected: number; count: number }>();
  for (const r of rows ?? []) {
    const key = gran === 'year' ? r.date.slice(0, 7) : r.date.slice(0, 10);
    const cur = bucketed.get(key) ?? { total: 0, collected: 0, count: 0 };
    cur.total += Number(r.total ?? 0);
    cur.collected += Number(r.collected ?? 0);
    cur.count += Number(r.count ?? 0);
    bucketed.set(key, cur);
  }

  const out: TrendPoint[] = [];

  if (gran === 'year') {
    const year = Number(from.slice(0, 4));
    for (let m = 0; m < 12; m += 1) {
      const key = `${year}-${String(m + 1).padStart(2, '0')}`;
      const at = new Date(year, m, 1);
      const v = bucketed.get(key) ?? { total: 0, collected: 0, count: 0 };
      out.push({
        key,
        label: at.toLocaleDateString(undefined, { month: 'short' }),
        full: at.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        ...v,
      });
    }
    return out;
  }

  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  // 400 is a guard, not a limit: the widest range this branch ever gets is a
  // single calendar month.
  while (cursor <= end && out.length < 400) {
    const key = iso(cursor);
    const v = bucketed.get(key) ?? { total: 0, collected: 0, count: 0 };
    out.push({
      key,
      label: String(cursor.getDate()),
      full: cursor.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
      ...v,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function StatTile({
  label, value, sub, pct, goodWhenUp = true, spark, color,
}: {
  label: string; value: string; sub?: string;
  pct?: number | null; goodWhenUp?: boolean; spark?: number[]; color?: string;
}) {
  return (
    <Card className="relative overflow-hidden border-border/70 shadow-sm transition-all hover:shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
          {pct !== undefined && <Trend pct={pct} goodWhenUp={goodWhenUp} />}
        </div>
        <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
        {spark && spark.length > 1 && color && (
          <div className="mt-2.5">
            <Sparkline points={spark} color={color} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type Granularity = 'day' | 'month' | 'year';

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayIso(): string {
  return iso(new Date());
}

function periodRange(gran: Granularity, anchor: string): { from: string; to: string; label: string } {
  const d = new Date(`${anchor}T00:00:00`);
  const y = d.getFullYear();
  const m = d.getMonth();

  if (gran === 'day') {
    return { from: anchor, to: anchor, label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) };
  }
  if (gran === 'month') {
    return {
      from: iso(new Date(y, m, 1)),
      to: iso(new Date(y, m + 1, 0)),
      label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    };
  }
  return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)), label: String(y) };
}

function shift(gran: Granularity, anchor: string, dir: -1 | 1): string {
  const d = new Date(`${anchor}T00:00:00`);
  if (gran === 'day') d.setDate(d.getDate() + dir);
  else if (gran === 'month') d.setMonth(d.getMonth() + dir, 1);
  else d.setFullYear(d.getFullYear() + dir, 0, 1);
  return iso(d);
}

function PeriodPicker({
  gran,
  anchor,
  label,
  onChange,
}: {
  gran: Granularity;
  anchor: string;
  label: string;
  onChange: (gran: Granularity, anchor: string) => void;
}) {
  const t = useTranslations();
  const isToday = anchor === todayIso();

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-background/80 p-1 shadow-sm backdrop-blur">
      <div className="flex rounded-md bg-muted/60 p-0.5">
        {(['day', 'month', 'year'] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => onChange(g, anchor)}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-all',
              gran === g
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {g === 'day' ? t('dashboard.perDay') : g === 'month' ? t('dashboard.perMonth') : t('dashboard.perYear')}
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-border mx-0.5" />

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => onChange(gran, shift(gran, anchor, -1))}
          title={t('dashboard.previousPeriod')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <label className="relative flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs font-medium hover:bg-muted">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{label}</span>
          <input
            type={gran === 'year' ? 'number' : gran === 'month' ? 'month' : 'date'}
            value={gran === 'year' ? anchor.slice(0, 4) : gran === 'month' ? anchor.slice(0, 7) : anchor}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              if (gran === 'year') onChange(gran, `${v}-01-01`);
              else if (gran === 'month') onChange(gran, `${v}-01`);
              else onChange(gran, v);
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => onChange(gran, shift(gran, anchor, 1))}
          title={t('dashboard.nextPeriod')}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {!isToday && (
        <>
          <div className="h-4 w-px bg-border mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs font-medium text-primary hover:bg-primary/10"
            onClick={() => onChange(gran, todayIso())}
          >
            {t('dashboard.today')}
          </Button>
        </>
      )}
    </div>
  );
}

/** Pagination control with page indicators */
function TablePagination({
  page,
  totalPages,
  totalItems,
  pageSize = 10,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (p: number) => void;
}) {
  const t = useTranslations();
  if (totalItems <= pageSize) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
      <span>
        {t('dashboard.showingRows', { from, to, total: totalItems })}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="px-2 font-medium">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

const PAGE_SIZE = 10;

export default function DashboardPage() {
  const t = useTranslations();
  const { resolvedTheme } = useTheme();
  const router = useRouter();
  const [gran, setGran] = useState<Granularity>('month');
  const [anchor, setAnchor] = useState<string>(todayIso());
  const [viewMode, setViewMode] = useState<'classic' | 'pro'>('pro');
  const [productsPage, setProductsPage] = useState(1);
  const [clientsPage, setClientsPage] = useState(1);
  const [trendView, setTrendView] = useState<'chart' | 'table'>('chart');
  const [user, setUserState] = useState<any>(null);

  useEffect(() => {
    setUserState(getUser());
    const saved = localStorage.getItem('sms_dashboard_view');
    if (saved === 'classic' || saved === 'pro') setViewMode(saved);
  }, []);

  const toggleViewMode = () => {
    const next = viewMode === 'pro' ? 'classic' : 'pro';
    setViewMode(next);
    localStorage.setItem('sms_dashboard_view', next);
  };

  const { from, to, label } = useMemo(() => periodRange(gran, anchor), [gran, anchor]);

  const { data, validating, refresh } = useLocalFirstData(
    `dashboard?from=${from}&to=${to}`,
    () => api.get('/reports/dashboard', { params: { from, to } }).then((r) => r.data),
  );

  const isDark = resolvedTheme === 'dark';
  const colors = isDark ? seriesColors.dark : seriesColors.light;
  const statusPalette = isDark ? statusColors.dark : statusColors.light;
  const ink = isDark ? chartInk.dark : chartInk.light;

  const tooltipStyle = useMemo(
    () => ({
      backgroundColor: isDark ? '#18181b' : '#ffffff',
      borderColor: isDark ? '#27272a' : '#e4e4e7',
      color: isDark ? '#fafafa' : '#18181b',
      borderRadius: '8px',
      fontSize: '12px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    }),
    [isDark],
  );

  const STATUS_COLOR: Record<string, string> = {
    CONFIRMED: statusPalette.good,
    DELIVERED: statusPalette.neutral,
    PARTIALLY_DELIVERED: statusPalette.warning,
    PENDING: '#a855f7',
    CANCELLED: statusPalette.critical,
  };

  const orderStatus = (data?.orderStatus ?? []).filter((s: any) => s.count > 0);
  const collectionMix = (data?.collectionMix ?? []).filter((s: any) => s.value > 0);

  // Pagination calculations
  const allTopProducts = data?.topProducts ?? [];
  const totalProductsPages = Math.max(1, Math.ceil(allTopProducts.length / PAGE_SIZE));
  const pagedProducts = allTopProducts.slice((productsPage - 1) * PAGE_SIZE, productsPage * PAGE_SIZE);

  const allTopClients = data?.topClients ?? [];
  const totalClientsPages = Math.max(1, Math.ceil(allTopClients.length / PAGE_SIZE));
  const pagedClients = allTopClients.slice((clientsPage - 1) * PAGE_SIZE, clientsPage * PAGE_SIZE);

  const sparkRevenue = (data?.salesByDay ?? []).map((d: any) => d.total);
  const sparkCollected = (data?.salesByDay ?? []).map((d: any) => d.collected ?? d.total * 0.8);

  /* --- Analytics Pro derivations --- */

  /** The window every delta chip is measured against, named rather than implied. */
  const prevLabel = useMemo(() => periodRange(gran, shift(gran, anchor, -1)).label, [gran, anchor]);

  const trend = useMemo(() => buildTrend(data?.salesByDay ?? [], gran, from, to), [data, gran, from, to]);

  /** Both series share one axis, so the ceiling is the taller of the two. */
  const trendTicks = useMemo(() => niceTicks(Math.max(0, ...trend.map((p) => p.total))), [trend]);

  /** The card surface, for the 2px ring that keeps an active dot legible on the line. */
  const surface = isDark ? '#1a1a19' : '#fdfcfa';

  const orderStatusTotal = Math.max(1, orderStatus.reduce((s: number, x: any) => s + x.count, 0));

  /**
   * Categories past the fifth fold into one "other" row. A ranked list stops
   * being readable well before a long tail of one-percent slivers runs out, and
   * the fold keeps the total honest instead of silently dropping the remainder.
   */
  const categoryRows = useMemo(() => {
    const rows = [...(data?.salesByCategory ?? [])].sort((a: any, b: any) => b.total - a.total);
    const total = rows.reduce((s: number, r: any) => s + r.total, 0);
    const share = (v: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : '—');
    const out = rows.slice(0, 5).map((r: any) => ({
      key: r.category,
      label: r.category,
      value: r.total,
      caption: share(r.total),
    }));
    const tail = rows.slice(5);
    if (tail.length > 0) {
      const rest = tail.reduce((s: number, r: any) => s + r.total, 0);
      out.push({
        key: '__other',
        label: t('dashboard.otherCategories', { count: tail.length }),
        value: rest,
        caption: share(rest),
      });
    }
    return out;
  }, [data, t]);

  if (!data) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-48" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const userName = user?.name ? user.name.split(' ')[0] : 'Admin';

  /**
   * The operational counts, each pointing at the page where you act on it.
   * Only the two that are genuinely an alert wear a tone — outstanding money is
   * ordinary business, and colouring it red every day teaches people to ignore
   * the colour on the day it matters.
   */
  const opsCells: {
    key: string;
    icon: ElementType;
    label: string;
    value: string;
    tone?: 'default' | 'good' | 'warning' | 'critical';
    href: string;
  }[] = [
    { key: 'grossProfit', icon: TrendingUp, label: t('dashboard.grossProfit'), value: fmtMoney(data.kpis.grossProfit), href: '/reports' },
    { key: 'receivables', icon: HandCoins, label: t('dashboard.receivables'), value: fmtMoney(data.kpis.accountsReceivable), href: '/invoices' },
    { key: 'payables', icon: CreditCard, label: t('dashboard.payables'), value: fmtMoney(data.kpis.accountsPayable), href: '/purchase-orders' },
    { key: 'pendingOrders', icon: Clock, label: t('dashboard.pendingOrders'), value: String(data.kpis.pendingOrders), href: '/sales-orders' },
    {
      key: 'lowStock',
      icon: Package,
      label: t('dashboard.lowStock'),
      value: String(data.kpis.lowStockCount),
      tone: data.kpis.lowStockCount > 0 ? 'warning' : 'good',
      href: '/inventory',
    },
    {
      key: 'openClaims',
      icon: ShieldCheck,
      label: t('dashboard.openClaims'),
      value: String(data.kpis.openClaims),
      tone: data.kpis.openClaims > 0 ? 'warning' : 'good',
      href: '/warranty',
    },
    { key: 'activeSystems', icon: Sun, label: t('dashboard.activeSystems'), value: String(data.kpis.activeInstallations), href: '/installations' },
    { key: 'energy', icon: Zap, label: t('dashboard.energyProduced'), value: `${compact(data.kpis.energyKwh)} kWh`, href: '/monitoring' },
  ];

  return (
    <div className="space-y-6">
      {/* The one filter row, above everything it scopes: change the period here
       * and every tile, chart and table below re-renders against the same
       * slice. No card carries a filter of its own. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              {t('dashboard.welcomeBack')}, <span className="text-primary">{userName}</span>
            </h1>
            <Badge variant="default" className="gap-1.5">
              {viewMode === 'pro' ? <Sparkles className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
              {viewMode === 'pro' ? t('dashboard.proView') : t('dashboard.classicView')}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('dashboard.showingPeriod')}: <span className="font-medium text-foreground">{label}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker
            gran={gran}
            anchor={anchor}
            label={label}
            onChange={(g, a) => {
              setGran(g);
              setAnchor(a);
              setProductsPage(1);
              setClientsPage(1);
            }}
          />

          <Button
            variant="outline"
            size="icon"
            onClick={() => refresh()}
            disabled={validating}
            title={t('dashboard.refresh')}
            aria-label={t('dashboard.refresh')}
          >
            <RefreshCw className={cn('h-4 w-4', validating && 'animate-spin')} />
          </Button>

          <Button
            variant="outline"
            onClick={toggleViewMode}
            className="gap-2 font-medium"
            title={viewMode === 'pro' ? t('dashboard.classicView') : t('dashboard.proView')}
          >
            {viewMode === 'pro' ? (
              <>
                <Layers className="h-4 w-4" />
                <span>{t('dashboard.classicView')}</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                <span>{t('dashboard.proView')}</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ============================ ANALYTICS PRO ============================
       *
       * Reading order is deliberate: one headline figure and the trend behind
       * it, then the four metrics that explain it, then the operational counts
       * you act on, then the breakdowns, then the rows. Nothing on this view is
       * illustrative — every mark is drawn from the same period the picker
       * above scopes, and a metric with no data says so instead of drawing a
       * plausible shape.
       * ==================================================================== */}
      {viewMode === 'pro' && (
        <div className={cn('space-y-4 animate-in fade-in-50 duration-300', validating && 'opacity-60 transition-opacity')}>
          {/* ---------------- Hero: the headline figure and its trend ---------------- */}
          <Card className="overflow-hidden border-border/60">
            <div className="grid lg:grid-cols-12">
              <div className="flex flex-col justify-between gap-6 border-b border-border/60 p-5 lg:col-span-4 lg:border-b-0 lg:border-e">
                <div>
                  <Eyebrow>{t('dashboard.totalRevenue')}</Eyebrow>
                  <div className="mt-2 text-4xl font-semibold leading-none tracking-tight md:text-[42px]">
                    {fmtMoney(data.kpis.revenue)}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Trend pct={data.deltas.revenue} goodWhenUp />
                    <span className="text-xs text-muted-foreground">
                      {prevLabel}{' '}
                      <span className="font-medium text-foreground/70">{fmtMoney(data.previous.revenue)}</span>
                    </span>
                  </div>
                  {data.kpis.refunds > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {t('dashboard.netOfRefunds', { amount: fmtMoney(data.kpis.refunds) })}
                    </div>
                  )}
                </div>

                <div>
                  <Eyebrow className="mb-2.5">{t('dashboard.collectionMix')}</Eyebrow>
                  <Meter
                    segments={[
                      {
                        key: 'collected',
                        label: t('dashboard.collected'),
                        value: data.kpis.collected,
                        color: statusPalette.good,
                      },
                      {
                        key: 'outstanding',
                        label: t('dashboard.outstanding'),
                        value: Math.max(0, data.kpis.revenue - data.kpis.collected),
                        color: statusPalette.neutral,
                      },
                    ]}
                  />
                </div>
              </div>

              <div className="flex min-w-0 flex-col lg:col-span-8">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4 pb-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">{t('dashboard.salesTrend')}</span>
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="flex items-center gap-3">
                      <LegendKey color={colors[0]} label={t('dashboard.revenue')} />
                      <LegendKey color={colors[1]} label={t('dashboard.collected')} />
                    </div>
                    {/* Chart and table are the same numbers — nothing is gated behind a hover. */}
                    <div className="flex rounded-md bg-muted/60 p-0.5">
                      {(['chart', 'table'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setTrendView(v)}
                          aria-pressed={trendView === v}
                          title={v === 'chart' ? t('dashboard.chartView') : t('dashboard.tableView')}
                          className={cn(
                            'rounded p-1.5 transition-colors',
                            trendView === v
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {v === 'chart' ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {trend.length < 2 ? (
                  <div className="flex h-[268px] flex-col items-center justify-center gap-3 px-6 text-center">
                    <p className="max-w-xs text-sm text-muted-foreground">{t('dashboard.trendNeedsRange')}</p>
                    <Button variant="outline" size="sm" onClick={() => setGran('month')}>
                      {t('dashboard.perMonth')}
                    </Button>
                  </div>
                ) : trendView === 'chart' ? (
                  <div dir="ltr" className="min-w-0 px-1 pb-3">
                    <ResponsiveContainer width="100%" height={268}>
                      <ComposedChart data={trend} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
                        <defs>
                          <linearGradient id="proRevenueWash" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={colors[0]} stopOpacity={0.22} />
                            <stop offset="100%" stopColor={colors[0]} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke={ink.grid} vertical={false} />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={{ stroke: ink.baseline }}
                          tick={{ fontSize: 11, fill: ink.muted }}
                          interval="preserveStartEnd"
                          minTickGap={14}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          width={54}
                          domain={[0, trendTicks[trendTicks.length - 1]]}
                          ticks={trendTicks}
                          tick={{ fontSize: 11, fill: ink.muted }}
                          tickFormatter={(v) => compact(Number(v))}
                        />
                        <Tooltip
                          cursor={{ stroke: ink.baseline, strokeWidth: 1 }}
                          content={<ChartTooltip format={(v) => fmtMoney(v)} />}
                        />
                        <Area
                          type="monotone"
                          dataKey="total"
                          name={t('dashboard.revenue')}
                          stroke={colors[0]}
                          strokeWidth={2}
                          fill="url(#proRevenueWash)"
                          activeDot={{ r: 4, strokeWidth: 2, stroke: surface }}
                        />
                        <Line
                          type="monotone"
                          dataKey="collected"
                          name={t('dashboard.collected')}
                          stroke={colors[1]}
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 2, stroke: surface }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="max-h-[268px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('common.date')}</TableHead>
                          <TableHead className="text-end">{t('dashboard.revenue')}</TableHead>
                          <TableHead className="text-end">{t('dashboard.collected')}</TableHead>
                          <TableHead className="text-end">{t('dashboard.ordersCount')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {trend.filter((p) => p.count > 0).length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                              {t('dashboard.noSales')}
                            </TableCell>
                          </TableRow>
                        ) : (
                          trend
                            .filter((p) => p.count > 0)
                            .map((p) => (
                              <TableRow key={p.key}>
                                <TableCell className="text-xs tabular-nums text-muted-foreground">{p.full}</TableCell>
                                <TableCell className="text-end text-sm font-semibold tabular-nums">
                                  {fmtMoney(p.total)}
                                </TableCell>
                                <TableCell className="text-end text-sm tabular-nums">{fmtMoney(p.collected)}</TableCell>
                                <TableCell className="text-end text-sm tabular-nums">{p.count}</TableCell>
                              </TableRow>
                            ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* ---------------- The four metrics that explain the headline ---------------- */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              label={t('dashboard.netProfit')}
              value={fmtMoney(data.kpis.netProfit)}
              pct={data.deltas.netProfit}
              current={data.kpis.netProfit}
              previous={data.previous.netProfit}
              previousLabel={prevLabel}
              previousValue={fmtMoney(data.previous.netProfit)}
              color={colors[0]}
            />
            <MetricTile
              label={t('dashboard.expenses')}
              value={fmtMoney(data.kpis.expenses)}
              pct={data.deltas.expenses}
              goodWhenUp={false}
              current={data.kpis.expenses}
              previous={data.previous.expenses}
              previousLabel={prevLabel}
              previousValue={fmtMoney(data.previous.expenses)}
              color={colors[4]}
            />
            <MetricTile
              label={t('dashboard.totalOrders')}
              value={data.kpis.invoiceCount.toLocaleString()}
              pct={data.deltas.invoiceCount}
              current={data.kpis.invoiceCount}
              previous={data.previous.invoiceCount}
              previousLabel={prevLabel}
              previousValue={data.previous.invoiceCount.toLocaleString()}
              color={colors[3]}
            />
            <MetricTile
              label={t('dashboard.newCustomers')}
              value={(data.kpis.newClientsCount ?? 0).toLocaleString()}
              pct={data.deltas.newClients}
              current={data.kpis.newClientsCount ?? 0}
              previous={data.previous.newClients ?? 0}
              previousLabel={prevLabel}
              previousValue={(data.previous.newClients ?? 0).toLocaleString()}
              color={colors[2]}
            />
          </div>

          {/* ---------------- Operations: counts you act on, each a way in ----------------
           * `gap-px` over a border-coloured ground draws the hairlines between
           * cells, so the rules stay perfect at every breakpoint the grid
           * reflows through without a single conditional border class.
           */}
          <Card className="overflow-hidden border-border/60">
            <div className="grid gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-4">
              {opsCells.map((c) => (
                <div key={c.key} className="bg-card">
                  <OpsCell
                    icon={c.icon}
                    label={c.label}
                    value={c.value}
                    tone={c.tone}
                    onClick={() => router.push(c.href)}
                  />
                </div>
              ))}
            </div>
          </Card>

          {/* ---------------- Where the revenue came from, and what is in flight ---------------- */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="border-border/60 lg:col-span-2">
              <CardHeader className="pb-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <CardTitle className="text-sm font-semibold">{t('dashboard.salesByCategory')}</CardTitle>
                  <span className="text-xs text-muted-foreground">{t('dashboard.shareOfRevenue')}</span>
                </div>
              </CardHeader>
              <CardContent>
                <RankedBars rows={categoryRows} color={colors[0]} empty={t('dashboard.noSales')} />
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-semibold">{t('dashboard.orderStatus')}</CardTitle>
                <CardDescription className="pt-1 text-2xl font-semibold leading-none tracking-tight text-foreground">
                  {orderStatus.length > 0 ? orderStatusTotal.toLocaleString() : '—'}
                  <span className="ms-2 text-xs font-normal text-muted-foreground">
                    {t('dashboard.ordersCount').toLowerCase()}
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                {orderStatus.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">{t('dashboard.noSales')}</div>
                ) : (
                  <div className="space-y-3">
                    {orderStatus.map((s: any) => (
                      <div key={s.status}>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <StatusChip status={s.status} />
                          <span className="text-sm font-semibold tabular-nums">{s.count}</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-muted/50">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(1.5, (s.count / orderStatusTotal) * 100)}%`,
                              backgroundColor: colors[0],
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ---------------- Recent transactions ---------------- */}
          {data.recentTransactions && data.recentTransactions.length > 0 && (
            <Card className="border-border/60">
              <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
                <div className="min-w-0">
                  <CardTitle className="text-sm font-semibold">{t('dashboard.recentTransactions')}</CardTitle>
                  <CardDescription className="text-xs">{t('dashboard.recentSales')}</CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 gap-1 text-xs text-primary"
                  onClick={() => router.push('/invoices')}
                >
                  {t('dashboard.viewAll')}
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">{t('quotations.number')}</TableHead>
                      <TableHead>{t('common.client')}</TableHead>
                      <TableHead className="hidden lg:table-cell">{t('dashboard.items')}</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead className="hidden text-end sm:table-cell">{t('common.date')}</TableHead>
                      <TableHead className="text-end">{t('common.total')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentTransactions.slice(0, 8).map((tx: any) => {
                      const paidShare = tx.total > 0 ? Math.min(1, Math.max(0, tx.paidAmount / tx.total)) : 0;
                      return (
                        <TableRow
                          key={tx.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => router.push(`/invoices/${tx.id}`)}
                        >
                          <TableCell className="font-mono text-xs font-semibold text-primary">{tx.number}</TableCell>
                          <TableCell className="text-sm font-medium">{tx.clientName}</TableCell>
                          <TableCell className="hidden max-w-64 truncate text-xs text-muted-foreground lg:table-cell">
                            {tx.itemsSummary}
                          </TableCell>
                          <TableCell>
                            <StatusChip status={tx.status} />
                          </TableCell>
                          <TableCell className="hidden text-end text-xs tabular-nums text-muted-foreground sm:table-cell">
                            {fmtDate(tx.date)}
                          </TableCell>
                          <TableCell className="text-end">
                            <div className="text-sm font-semibold tabular-nums">{fmtMoney(tx.total)}</div>
                            {/* The status chip already names the state; this only shows how far along it is. */}
                            <div
                              className="ms-auto mt-1.5 h-1 w-16 rounded-full bg-muted/60"
                              title={`${t('dashboard.collected')}: ${fmtMoney(tx.paidAmount)}`}
                            >
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${paidShare * 100}%`, backgroundColor: statusPalette.good }}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* ---------------- Leaderboards ---------------- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="flex min-w-0 flex-col border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">{t('dashboard.topProducts')}</CardTitle>
                <CardDescription className="text-xs">
                  {t('dashboard.rankedByRevenue', { count: allTopProducts.length })}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>{t('common.product')}</TableHead>
                      <TableHead className="w-20 text-end">{t('dashboard.qtySold')}</TableHead>
                      <TableHead className="w-32 text-end">{t('dashboard.revenue')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedProducts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                          {t('dashboard.noSales')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      pagedProducts.map((p: any, idx: number) => (
                        <TableRow key={p.sku} className="hover:bg-muted/40">
                          <TableCell>
                            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
                              {(productsPage - 1) * PAGE_SIZE + idx + 1}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[220px]">
                            <div className="truncate text-sm font-medium">{p.name}</div>
                            <div className="truncate font-mono text-[11px] text-muted-foreground">{p.sku}</div>
                          </TableCell>
                          <TableCell className="text-end text-sm tabular-nums">{p.qty}</TableCell>
                          <TableCell className="text-end text-sm font-semibold tabular-nums">
                            {fmtMoney(p.revenue)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
              <TablePagination
                page={productsPage}
                totalPages={totalProductsPages}
                totalItems={allTopProducts.length}
                pageSize={PAGE_SIZE}
                onPageChange={setProductsPage}
              />
            </Card>

            <Card className="flex min-w-0 flex-col border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">{t('dashboard.topClients')}</CardTitle>
                <CardDescription className="text-xs">
                  {t('dashboard.rankedByRevenue', { count: allTopClients.length })}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>{t('common.client')}</TableHead>
                      <TableHead className="w-20 text-end">{t('dashboard.ordersCount')}</TableHead>
                      <TableHead className="w-32 text-end">{t('dashboard.revenue')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedClients.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                          {t('dashboard.noSales')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      pagedClients.map((c: any, idx: number) => (
                        <TableRow
                          key={c.clientId ?? idx}
                          className={cn('hover:bg-muted/40', c.clientId && 'cursor-pointer')}
                          onClick={() => c.clientId && router.push(`/clients/${c.clientId}`)}
                        >
                          <TableCell>
                            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
                              {(clientsPage - 1) * PAGE_SIZE + idx + 1}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[220px]">
                            <div className="truncate text-sm font-medium">{c.name}</div>
                            {c.phone && (
                              <div className="truncate font-mono text-[11px] text-muted-foreground">{c.phone}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-end text-sm tabular-nums">{c.invoices}</TableCell>
                          <TableCell className="text-end text-sm font-semibold tabular-nums">
                            {fmtMoney(c.revenue)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
              <TablePagination
                page={clientsPage}
                totalPages={totalClientsPages}
                totalItems={allTopClients.length}
                pageSize={PAGE_SIZE}
                onPageChange={setClientsPage}
              />
            </Card>
          </div>
        </div>
      )}

      {/* ======================= CLASSIC DASHBOARD VIEW ======================= */}
      {viewMode === 'classic' && (
        <div className="space-y-6 animate-in fade-in-50 duration-300">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label={t('dashboard.revenue')}
              value={fmtMoney(data.kpis.revenue)}
              sub={data.previous.revenue > 0 ? `${fmtMoney(data.previous.revenue)} ${t('dashboard.vsPrevious')}` : undefined}
              pct={data.deltas.revenue}
              goodWhenUp={true}
              spark={sparkRevenue}
              color={colors[0]}
            />
            <StatTile
              label={t('dashboard.collected')}
              value={fmtMoney(data.kpis.collected)}
              sub={data.previous.collected > 0 ? `${fmtMoney(data.previous.collected)} ${t('dashboard.vsPrevious')}` : undefined}
              pct={data.deltas.collected}
              goodWhenUp={true}
              spark={sparkCollected}
              color={statusPalette.good}
            />
            <StatTile
              label={t('dashboard.grossProfit')}
              value={fmtMoney(data.kpis.grossProfit)}
              sub={data.previous.grossProfit > 0 ? `${fmtMoney(data.previous.grossProfit)} ${t('dashboard.vsPrevious')}` : undefined}
              pct={data.deltas.grossProfit}
              goodWhenUp={true}
            />
            <StatTile
              label={t('dashboard.netProfit')}
              value={fmtMoney(data.kpis.netProfit)}
              sub={data.previous.netProfit !== 0 ? `${fmtMoney(data.previous.netProfit)} ${t('dashboard.vsPrevious')}` : undefined}
              pct={data.deltas.netProfit}
              goodWhenUp={true}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label={t('dashboard.receivables')}
              value={fmtMoney(data.kpis.accountsReceivable)}
              goodWhenUp={false}
            />
            <StatTile
              label={t('dashboard.payables')}
              value={fmtMoney(data.kpis.accountsPayable)}
              goodWhenUp={false}
            />
            <StatTile
              label={t('dashboard.pendingOrders')}
              value={String(data.kpis.pendingOrders)}
              goodWhenUp={false}
            />
            <StatTile
              label={t('dashboard.lowStock')}
              value={String(data.kpis.lowStockCount)}
              goodWhenUp={false}
            />
          </div>

          {/* Area chart & Bar chart */}
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('dashboard.salesByDay')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div dir="ltr">
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={data.salesByDay} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={ink.grid} vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: ink.muted }}
                        stroke={ink.baseline}
                        tickFormatter={(v) => (gran === 'day' ? v.slice(11, 16) || v : v.slice(5))}
                      />
                      <YAxis tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} width={70} />
                      <Tooltip formatter={(v: any) => fmtMoney(v)} contentStyle={tooltipStyle} />
                      <Area type="monotone" dataKey="total" name={t('dashboard.revenue')} stroke={colors[0]} strokeWidth={2} fill={colors[0]} fillOpacity={0.12} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('dashboard.salesByCategory')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div dir="ltr">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.salesByCategory} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={ink.grid} vertical={false} />
                      <XAxis dataKey="category" tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} />
                      <YAxis tick={{ fontSize: 11, fill: ink.muted }} stroke={ink.baseline} width={70} />
                      <Tooltip formatter={(v: any) => fmtMoney(v)} contentStyle={tooltipStyle} cursor={{ fill: ink.grid, opacity: 0.4 }} />
                      <Bar dataKey="total" name={t('dashboard.revenue')} fill={colors[0]} radius={[4, 4, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Proportions Doughnuts */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('dashboard.orderStatus')}</CardTitle>
              </CardHeader>
              <CardContent>
                {orderStatus.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">{t('dashboard.noSales')}</p>
                ) : (
                  <div dir="ltr">
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie
                          data={orderStatus}
                          dataKey="count"
                          nameKey="status"
                          innerRadius="55%"
                          outerRadius="82%"
                          paddingAngle={2}
                          stroke="none"
                        >
                          {orderStatus.map((s: any) => (
                            <Cell key={s.status} fill={STATUS_COLOR[s.status] ?? statusPalette.neutral} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v: any, n: any) => [v, t(`status.${n}`)]}
                        />
                        <Legend
                          formatter={(v: any) => <span style={{ color: ink.muted, fontSize: 12 }}>{t(`status.${v}`)}</span>}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('dashboard.collectionMix')}</CardTitle>
              </CardHeader>
              <CardContent>
                {collectionMix.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">{t('dashboard.noSales')}</p>
                ) : (
                  <div dir="ltr">
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie
                          data={collectionMix}
                          dataKey="value"
                          nameKey="key"
                          innerRadius="55%"
                          outerRadius="82%"
                          paddingAngle={2}
                          stroke="none"
                        >
                          {collectionMix.map((s: any) => (
                            <Cell
                              key={s.key}
                              fill={s.key === 'collected' ? statusPalette.good : statusPalette.warning}
                            />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtMoney(v), t(`dashboard.${n}`)]} />
                        <Legend
                          formatter={(v: any) => <span style={{ color: ink.muted, fontSize: 12 }}>{t(`dashboard.${v}`)}</span>}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top Products & Top Clients with 10-item pagination in Classic View too */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="flex flex-col justify-between">
              <div>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{t('dashboard.topProducts')}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('products.sku')}</TableHead>
                        <TableHead>{t('common.product')}</TableHead>
                        <TableHead className="text-end">{t('dashboard.qtySold')}</TableHead>
                        <TableHead className="text-end">{t('dashboard.revenue')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedProducts.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                            {t('dashboard.noSales')}
                          </TableCell>
                        </TableRow>
                      )}
                      {pagedProducts.map((p: any) => (
                        <TableRow key={p.sku}>
                          <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                          <TableCell>{p.name}</TableCell>
                          <TableCell className="text-end tabular-nums">{p.qty}</TableCell>
                          <TableCell className="text-end tabular-nums font-semibold">{fmtMoney(p.revenue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </div>
              <TablePagination
                page={productsPage}
                totalPages={totalProductsPages}
                totalItems={allTopProducts.length}
                pageSize={PAGE_SIZE}
                onPageChange={setProductsPage}
              />
            </Card>

            <Card className="flex flex-col justify-between">
              <div>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{t('dashboard.topClients')}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('common.client')}</TableHead>
                        <TableHead className="text-end">{t('dashboard.ordersCount')}</TableHead>
                        <TableHead className="text-end">{t('dashboard.revenue')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedClients.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                            {t('dashboard.noSales')}
                          </TableCell>
                        </TableRow>
                      )}
                      {pagedClients.map((c: any) => (
                        <TableRow key={c.clientId ?? c.name}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell className="text-end tabular-nums">{c.invoices}</TableCell>
                          <TableCell className="text-end tabular-nums font-semibold">{fmtMoney(c.revenue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </div>
              <TablePagination
                page={clientsPage}
                totalPages={totalClientsPages}
                totalItems={allTopClients.length}
                pageSize={PAGE_SIZE}
                onPageChange={setClientsPage}
              />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
