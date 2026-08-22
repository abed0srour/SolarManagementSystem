'use client';
import { Calculator as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import {
  AlertTriangle, BatteryCharging, Calculator, FileText, Leaf, Moon, PackagePlus,
  PiggyBank, Sun, TriangleAlert, Zap,
} from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { api, errMsg, fmtMoney } from '../../../lib/api';
import { seriesColors, chartInk } from '../../../lib/charts';
import { cn } from '../../../lib/utils';
import Field from '../../../components/form-field';
import { ClientPicker, WarehousePicker } from '../../../components/entity-picker';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { FormattedNumberInput } from '../../../components/ui/formatted-number-input';
import { Select } from '../../../components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

type Option = {
  id: string; sku: string; name: string; brand: string | null;
  salePrice: number; inStock: number; spec: number; specLabel?: string;
  count: number; lineTotal: number; shortBy: number;
};

type Coverage = { total: number; usable: number; missingSpec: number };

function OptionsTable({
  title, icon: Icon, options, coverage, selected, onSelect, t,
}: {
  title: string; icon: React.ElementType; options: Option[]; coverage?: Coverage;
  selected: string | null; onSelect: (id: string) => void; t: any;
}) {
  // Still render when empty: an empty category with a reason is information,
  // whereas a vanished section reads as the tool being broken.
  if (options.length === 0 && !coverage?.missingSpec) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onSelect(o.id)}
            className={cn(
              'flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-2 text-start text-sm transition-colors',
              selected === o.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent',
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{o.name}</span>
              <span className="text-xs text-muted-foreground">
                {o.sku} · {o.specLabel ?? o.spec}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {t('calculator.needed')}: <b className="text-foreground tabular-nums">{o.count}×</b>
            </span>
            <span className="text-xs">
              {o.shortBy > 0 ? (
                <Badge variant="destructive">{t('calculator.shortBy', { n: o.shortBy })}</Badge>
              ) : (
                <Badge variant="success">{t('calculator.inStock')}: {o.inStock}</Badge>
              )}
            </span>
            <span className="tabular-nums font-semibold">{fmtMoney(o.lineTotal)}</span>
          </button>
        ))}

        {/*
          Matching reads specs out of each product's attributes, so a panel with
          no wattage recorded can never be recommended. Saying so turns a
          confusing empty list into a task.
        */}
        {!!coverage?.missingSpec && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t('calculator.missingSpecs', { n: coverage.missingSpec })}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One numbered step of the form.
 *
 * The number is what makes a long form feel finite: three steps read as a task
 * with an end, where the same fields in one block read as a wall.
 */
function Step({
  n, title, hint, last, children,
}: {
  n: number; title: string; hint?: string; last?: boolean; children: React.ReactNode;
}) {
  return (
    <section className={cn('space-y-4 p-4', !last && 'border-b')}>
      <div className="flex items-baseline gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {n}
        </span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function CalculatorPage() {
  const t = useTranslations();
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const mode = resolvedTheme === 'dark' ? 'dark' : 'light';
  const colors = seriesColors[mode];
  const ink = chartInk[mode];

  const [form, setForm] = useState<any>({
    mode: 'LOAD',
    // BILL
    monthlyKwh: '600',
    backupHours: '8',
    // LOAD
    dayAmps: '40', dayHours: '8', nightAmps: '20', nightHours: '12',
    systemVoltage: '48', phase: 'DC', powerFactor: '0.8', surgeFactor: '1',
    // shared
    sunHoursPerDay: '5', lossFactor: '0.8', systemType: 'HYBRID',
    autonomyDays: '1', batteryVoltage: '48', tariffPerKwh: '0.2', peakLoadKw: '',
  });
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<{ panel: string | null; inverter: string | null; battery: string | null }>({ panel: null, inverter: null, battery: null });
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [client, setClient] = useState<any>(null);
  const [warehouse, setWarehouse] = useState<any>(null);

  const isLoad = form.mode === 'LOAD';
  const num = (v: any) => (v === '' || v === undefined || v === null ? undefined : Number(v));

  /**
   * Wattage the entered current implies, shown live under the inputs.
   *
   * Mirrors `powerFromCurrent` on the server — the server stays the authority
   * for the result, but a rep needs to see straight away that 32 A on a
   * three-phase 400 V supply is 17.7 kW and not 12.8 kW, because a wrong phase
   * setting is invisible until the whole system comes out the wrong size.
   */
  const livePower = (amps: any) => {
    const a = Number(amps) || 0;
    const v = Number(form.systemVoltage) || 0;
    if (!a || !v) return 0;
    if (form.phase === 'DC') return a * v;
    const pf = Number(form.powerFactor) || 0.8;
    return (form.phase === 'THREE' ? Math.sqrt(3) : 1) * v * a * pf;
  };

  const calculate = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/solar-calculator/size', {
        mode: form.mode,
        ...(isLoad
          ? {
              dayAmps: num(form.dayAmps), dayHours: num(form.dayHours),
              nightAmps: num(form.nightAmps), nightHours: num(form.nightHours),
              systemVoltage: num(form.systemVoltage), phase: form.phase,
              powerFactor: form.phase === 'DC' ? undefined : num(form.powerFactor),
              surgeFactor: num(form.surgeFactor),
            }
          : { monthlyKwh: num(form.monthlyKwh), backupHours: num(form.backupHours) }),
        sunHoursPerDay: num(form.sunHoursPerDay),
        lossFactor: num(form.lossFactor),
        systemType: form.systemType,
        autonomyDays: num(form.autonomyDays),
        batteryVoltage: num(form.batteryVoltage),
        tariffPerKwh: num(form.tariffPerKwh),
        peakLoadKw: num(form.peakLoadKw),
      });
      setResult(data);
      setSelection({
        panel: data.options.panels[0]?.id ?? null,
        inverter: data.options.inverters[0]?.id ?? null,
        battery: data.options.batteries[0]?.id ?? null,
      });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const chosen: Option[] = result
    ? ([
        result.options.panels.find((o: Option) => o.id === selection.panel),
        result.options.inverters.find((o: Option) => o.id === selection.inverter),
        result.options.batteries.find((o: Option) => o.id === selection.battery),
      ].filter(Boolean) as Option[])
    : [];
  const bundleTotal = chosen.reduce((s, o) => s + o.lineTotal, 0);
  const annualSavings = result?.roi.annualSavings ?? 0;
  const payback = annualSavings > 0 && bundleTotal > 0 ? (bundleTotal / annualSavings).toFixed(1) : null;
  const anyShort = chosen.some((o) => o.shortBy > 0);

  const sizingNote = () =>
    isLoad
      ? `Solar sizing: ${form.dayAmps}A×${form.dayHours}h day / ${form.nightAmps}A×${form.nightHours}h night @ ${form.systemVoltage}V ${form.phase}, ${result.sizing.requiredArrayKw} kWp, ${form.systemType}`
      : `Solar sizing: ${form.monthlyKwh} kWh/month, ${result.sizing.requiredArrayKw} kWp array, ${form.systemType}`;

  const lineItems = () => chosen.map((o) => ({ productId: o.id, quantity: o.count, unitPrice: o.salePrice }));

  const createQuotation = async () => {
    try {
      const { data } = await api.post('/quotations', {
        clientId: client.id,
        notes: sizingNote(),
        items: lineItems(),
      });
      toast.success(`${t('calculator.quotationCreated')}: ${data.number}`);
      setQuoteOpen(false);
      router.push('/quotations');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const createOrder = async () => {
    try {
      const { data } = await api.post('/sales-orders', {
        clientId: client.id,
        warehouseId: warehouse.id,
        notes: sizingNote(),
        items: lineItems(),
      });
      toast.success(`${t('calculator.orderCreated')}: ${data.number}`);
      setOrderOpen(false);
      router.push(`/sales-orders/${data.id}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const tooltipStyle = {
    backgroundColor: mode === 'dark' ? '#1a1a19' : '#fcfcfb',
    border: `1px solid ${ink.grid}`,
    borderRadius: 8,
    fontSize: 12,
  };

  // Day vs night energy, and where the money goes. Two questions, two charts.
  const energySplit = result
    ? [
        { key: t('calculator.daytime'), value: Math.round(result.energy.dayWh) },
        { key: t('calculator.nighttime'), value: Math.round(result.energy.nightWh) },
      ].filter((d) => d.value > 0)
    : [];
  const costSplit = chosen.map((o) => ({ key: o.name, value: o.lineTotal }));

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('calculator.title')} subtitle={t('calculator.subtitle')} />

      {/*
        Three numbered steps rather than one wall of inputs. The fields divide
        cleanly by where their values come from — the customer, the site, and the
        tariff — and a sales rep collects them in that order. Every step uses the
        same 4-column grid so labels and controls line up down the whole form.
      */}
      <Card>
        <CardContent className="p-0">
          <Step n={1} title={t('calculator.stepLoad')} hint={t('calculator.stepLoadHint')}>
            {/* How the load is known: a bill, or a clamp meter on site. */}
            <div className="inline-flex rounded-lg border p-1">
              {(['LOAD', 'BILL'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm({ ...form, mode: m })}
                  aria-pressed={form.mode === m}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    form.mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {t(m === 'LOAD' ? 'calculator.modeLoad' : 'calculator.modeBill')}
                </button>
              ))}
            </div>

            {isLoad ? (
              <div className="space-y-4">
                {/* Day and night are one measurement each, so they pair up. */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <Sun className="h-4 w-4 text-amber-500" /> {t('calculator.daytime')}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={t('calculator.current')}>
                        <Input type="number" step="0.1" min="0" placeholder="e.g. 15" value={form.dayAmps} onChange={(e) => setForm({ ...form, dayAmps: e.target.value })} />
                      </Field>
                      <Field label={t('calculator.hours')}>
                        <Input type="number" step="0.5" min="0" max="24" placeholder="10" value={form.dayHours} onChange={(e) => setForm({ ...form, dayHours: e.target.value })} />
                      </Field>
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <Moon className="h-4 w-4 text-indigo-400" /> {t('calculator.nighttime')}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={t('calculator.current')}>
                        <Input type="number" step="0.1" min="0" placeholder="e.g. 8" value={form.nightAmps} onChange={(e) => setForm({ ...form, nightAmps: e.target.value })} />
                      </Field>
                      <Field label={t('calculator.hours')}>
                        <Input type="number" step="0.5" min="0" max="24" placeholder="14" value={form.nightHours} onChange={(e) => setForm({ ...form, nightHours: e.target.value })} />
                      </Field>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <Field label={t('calculator.phase')}>
                    <Select value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })}>
                      <option value="DC">{t('calculator.phaseDC')}</option>
                      <option value="SINGLE">{t('calculator.phaseSingle')}</option>
                      <option value="THREE">{t('calculator.phaseThree')}</option>
                    </Select>
                  </Field>
                  <Field label={t('calculator.systemVoltage')}>
                    <Select value={form.systemVoltage} onChange={(e) => setForm({ ...form, systemVoltage: e.target.value })}>
                      {['12', '24', '48', '230', '400'].map((v) => <option key={v} value={v}>{v} V</option>)}
                    </Select>
                  </Field>
                  {/* Power factor is meaningless on DC, so it is locked there. */}
                  <Field label={t('calculator.powerFactor')}>
                    <Input
                      type="number" step="0.05" min="0.5" max="1"
                      placeholder="0.9"
                      value={form.phase === 'DC' ? '1' : form.powerFactor}
                      disabled={form.phase === 'DC'}
                      onChange={(e) => setForm({ ...form, powerFactor: e.target.value })}
                    />
                  </Field>
                  <Field label={t('calculator.surgeFactor')}>
                    <Select value={form.surgeFactor} onChange={(e) => setForm({ ...form, surgeFactor: e.target.value })}>
                      <option value="1">1× — {t('calculator.surgeNone')}</option>
                      <option value="2">2× — {t('calculator.surgeLight')}</option>
                      <option value="3">3× — {t('calculator.surgeMotor')}</option>
                      <option value="5">5× — {t('calculator.surgeHeavy')}</option>
                    </Select>
                  </Field>
                </div>

                {/* Live wattage from the amps just typed: the cheapest way to
                    catch a mis-set voltage or phase before it becomes a quote. */}
                <p className="text-xs text-muted-foreground">
                  {t('calculator.derivedPower')}:{' '}
                  <b className="text-foreground tabular-nums">{(livePower(form.dayAmps) / 1000).toFixed(2)} kW</b>{' '}
                  {t('calculator.byDay')} ·{' '}
                  <b className="text-foreground tabular-nums">{(livePower(form.nightAmps) / 1000).toFixed(2)} kW</b>{' '}
                  {t('calculator.byNight')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <Field label={t('calculator.monthlyKwh')}>
                  <Input type="number" placeholder="e.g. 600" value={form.monthlyKwh} onChange={(e) => setForm({ ...form, monthlyKwh: e.target.value })} />
                </Field>
                <Field label={t('calculator.backupHours')}>
                  <Input type="number" placeholder="e.g. 8" value={form.backupHours} onChange={(e) => setForm({ ...form, backupHours: e.target.value })} />
                </Field>
                <Field label={t('calculator.peakLoad')} hint={t('calculator.peakLoadHint')}>
                  <Input type="number" step="0.1" placeholder="e.g. 4.5" value={form.peakLoadKw} onChange={(e) => setForm({ ...form, peakLoadKw: e.target.value })} />
                </Field>
              </div>
            )}
          </Step>

          <Step n={2} title={t('calculator.stepSite')} hint={t('calculator.stepSiteHint')}>
            {/* A slider, because peak sun hours is a regional estimate, not a
                measurement — and the endpoints tell you the plausible range. */}
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">{t('calculator.sunHours')}</span>
                <span className="text-lg font-bold tabular-nums">{form.sunHoursPerDay} h</span>
              </div>
              <input
                type="range" min="3" max="7" step="0.1"
                value={form.sunHoursPerDay}
                onChange={(e) => setForm({ ...form, sunHoursPerDay: e.target.value })}
                aria-label={t('calculator.sunHours')}
                className="mt-2 w-full cursor-pointer accent-primary"
              />
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>3 h</span>
                <span>5 h</span>
                <span>7 h</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <Field label={t('installations.systemType')}>
                <Select value={form.systemType} onChange={(e) => setForm({ ...form, systemType: e.target.value })}>
                  {['ON_GRID', 'OFF_GRID', 'HYBRID'].map((x) => <option key={x} value={x}>{t(`installations.${x}`)}</option>)}
                </Select>
              </Field>
              <Field label={t('calculator.lossFactor')}>
                <Select value={form.lossFactor} onChange={(e) => setForm({ ...form, lossFactor: e.target.value })}>
                  {['0.75', '0.8', '0.85', '0.9'].map((v) => <option key={v} value={v}>{Number(v) * 100}%</option>)}
                </Select>
              </Field>
              <Field label={t('calculator.autonomyDays')}>
                <Select value={form.autonomyDays} onChange={(e) => setForm({ ...form, autonomyDays: e.target.value })}>
                  {['1', '2', '3'].map((v) => <option key={v} value={v}>{v}</option>)}
                </Select>
              </Field>
              <Field label={t('calculator.batteryVoltage')}>
                <Select value={form.batteryVoltage} onChange={(e) => setForm({ ...form, batteryVoltage: e.target.value })}>
                  {['12', '24', '48'].map((v) => <option key={v} value={v}>{v} V</option>)}
                </Select>
              </Field>
            </div>
          </Step>

          <Step n={3} title={t('calculator.stepMoney')} hint={t('calculator.stepMoneyHint')} last>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <Field label={t('calculator.tariff')}>
                <FormattedNumberInput placeholder="0.25" value={form.tariffPerKwh} onChange={(e) => setForm({ ...form, tariffPerKwh: e.target.value })} />
              </Field>
            </div>
          </Step>

          {/* The action sits on its own bar so it reads as "done with the form". */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t bg-muted/30 px-4 py-3">
            <p className="text-xs text-muted-foreground">{t('calculator.calculateHint')}</p>
            <Button
              className="h-11 px-6 text-base w-full sm:w-auto"
              onClick={calculate}
              disabled={busy || (isLoad ? !form.dayAmps && !form.nightAmps : !form.monthlyKwh)}
            >
              <Calculator /> {busy ? t('common.loading') : t('calculator.calculate')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{t('calculator.dailyUse')}</div>
              <div className="text-xl font-bold tabular-nums">{result.sizing.dailyKwh} kWh</div>
              <div className="mt-0.5 text-xs text-muted-foreground">≈ {result.energy.monthlyKwh} kWh/{t('calculator.month')}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{t('calculator.requiredArray')}</div>
              <div className="text-xl font-bold tabular-nums">{result.sizing.requiredArrayKw} kWp</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{t('calculator.requiredInverter')}</div>
              <div className="text-xl font-bold tabular-nums">{result.sizing.requiredInverterKw} kW</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {t('calculator.continuous')} {result.sizing.continuousKw} kW · {t('calculator.surge')} {result.sizing.surgeKw} kW
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{t('calculator.requiredBackup')}</div>
              <div className="text-xl font-bold tabular-nums">{result.sizing.requiredBackupKwh} kWh</div>
              <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {result.sizing.requiredBackupAh} Ah @ {result.sizing.batteryVoltage} V
              </div>
            </CardContent></Card>
          </div>

          {/* No inverter in the catalogue is large enough — say so, don't show nothing. */}
          {result.notes?.noInverterLargeEnough && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('calculator.noInverter', { kw: result.notes.noInverterLargeEnough.requiredKw })}</span>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{t('calculator.energyBalance')}</CardTitle></CardHeader>
              <CardContent>
                <div dir="ltr">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={energySplit} dataKey="value" nameKey="key"
                        innerRadius={55} outerRadius={85} paddingAngle={2}
                        label={(e: any) => `${e.key}: ${(e.value / 1000).toFixed(1)} kWh`}
                        labelLine={false}
                      >
                        {energySplit.map((_, i) => <Cell key={i} fill={colors[i]} stroke={mode === 'dark' ? '#1a1a19' : '#fcfcfb'} strokeWidth={2} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => `${(Number(v) / 1000).toFixed(2)} kWh`} contentStyle={tooltipStyle} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-2 rounded-md border p-2">
                    <Sun className="h-4 w-4 text-amber-500" />
                    <span className="text-muted-foreground">{t('calculator.dayLoad')}</span>
                    <span className="ms-auto tabular-nums font-medium">{(result.energy.dayPowerW / 1000).toFixed(2)} kW</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border p-2">
                    <Moon className="h-4 w-4 text-indigo-400" />
                    <span className="text-muted-foreground">{t('calculator.nightLoad')}</span>
                    <span className="ms-auto tabular-nums font-medium">{(result.energy.nightPowerW / 1000).toFixed(2)} kW</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{t('calculator.costComposition')}</CardTitle></CardHeader>
              <CardContent>
                {costSplit.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">{t('calculator.pickComponents')}</p>
                ) : (
                  <div dir="ltr">
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={costSplit} dataKey="value" nameKey="key"
                          innerRadius={55} outerRadius={85} paddingAngle={2}
                          label={(e: any) => `${Math.round((e.value / bundleTotal) * 100)}%`}
                          labelLine={false}
                        >
                          {costSplit.map((_, i) => <Cell key={i} fill={colors[i]} stroke={mode === 'dark' ? '#1a1a19' : '#fcfcfb'} strokeWidth={2} />)}
                        </Pie>
                        <Tooltip formatter={(v: any) => fmtMoney(Number(v))} contentStyle={tooltipStyle} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <OptionsTable title={t('calculator.panels')} icon={Sun} options={result.options.panels} coverage={result.coverage?.panels} selected={selection.panel} onSelect={(id) => setSelection({ ...selection, panel: id })} t={t} />
              <OptionsTable title={t('calculator.inverters')} icon={Zap} options={result.options.inverters} coverage={result.coverage?.inverters} selected={selection.inverter} onSelect={(id) => setSelection({ ...selection, inverter: id })} t={t} />
              <OptionsTable title={t('calculator.batteries')} icon={BatteryCharging} options={result.options.batteries} coverage={result.coverage?.batteries} selected={selection.battery} onSelect={(id) => setSelection({ ...selection, battery: id })} t={t} />
            </div>

            <div className="space-y-4">
              <Card className="border-primary/40">
                <CardHeader className="pb-2"><CardTitle className="text-base">{t('calculator.recommendedBundle')}</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {chosen.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{o.count}× {o.name}</span>
                      <span className="shrink-0 tabular-nums">{fmtMoney(o.lineTotal)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t pt-2 text-base font-bold">
                    <span>{t('calculator.estimatedTotal')}</span>
                    <span className="tabular-nums">{fmtMoney(bundleTotal)}</span>
                  </div>

                  {/* An order draws stock on confirm, so a shortage matters more there. */}
                  {anyShort && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{t('calculator.shortageWarning')}</span>
                    </div>
                  )}

                  <div className="grid gap-2 pt-1">
                    <Button className="w-full" onClick={() => setOrderOpen(true)} disabled={chosen.length === 0}>
                      <PackagePlus /> {t('calculator.createOrder')}
                    </Button>
                    <Button variant="outline" className="w-full" onClick={() => setQuoteOpen(true)} disabled={chosen.length === 0}>
                      <FileText /> {t('calculator.createQuotation')}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base"><PiggyBank className="h-4 w-4 text-primary" /> {t('calculator.roi')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('calculator.annualProduction')}</span><span className="tabular-nums font-medium">{result.roi.annualProductionKwh.toLocaleString()} kWh</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('calculator.annualSavings')}</span><span className="tabular-nums font-medium">{fmtMoney(result.roi.annualSavings)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('calculator.payback')}</span><span className="tabular-nums font-medium">{payback ? `${payback} ${t('calculator.years')}` : '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('calculator.savings25')}</span><span className="tabular-nums font-medium">{fmtMoney(result.roi.annualSavings * 25)}</span></div>
                  <div className="flex justify-between"><span className="inline-flex items-center gap-1 text-muted-foreground"><Leaf className="h-3.5 w-3.5 text-green-600" /> {t('calculator.co2PerYear')}</span><span className="tabular-nums font-medium">{result.roi.co2SavedKgPerYear.toLocaleString()} kg</span></div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      <Dialog open={quoteOpen} onOpenChange={setQuoteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('calculator.createQuotation')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label={t('calculator.pickClient')}>
              <ClientPicker value={client} onChange={setClient} />
            </Field>
            <BundleSummary chosen={chosen} total={bundleTotal} t={t} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuoteOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={createQuotation} disabled={!client}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('calculator.createOrder')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label={t('calculator.pickClient')}>
              <ClientPicker value={client} onChange={setClient} />
            </Field>
            {/* An order is fulfilled from a specific warehouse, so it must be chosen. */}
            <Field label={t('common.warehouse')}>
              <WarehousePicker value={warehouse} onChange={setWarehouse} />
            </Field>
            <BundleSummary chosen={chosen} total={bundleTotal} t={t} />
            <p className="text-xs text-muted-foreground">{t('calculator.orderStockNote')}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrderOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={createOrder} disabled={!client || !warehouse}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BundleSummary({ chosen, total, t }: { chosen: Option[]; total: number; t: any }) {
  return (
    <div className="rounded-md border p-3 text-sm">
      {chosen.map((o) => (
        <div key={o.id} className="flex justify-between gap-2">
          <span className="min-w-0 truncate">{o.count}× {o.name}</span>
          <span className="shrink-0 tabular-nums">{fmtMoney(o.lineTotal)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t pt-1 font-bold">
        <span>{t('common.total')}</span>
        <span className="tabular-nums">{fmtMoney(total)}</span>
      </div>
    </div>
  );
}
