'use client';
import { Calculator as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BatteryCharging, Calculator, FileText, Leaf, PiggyBank, Sun, Zap } from 'lucide-react';
import { api, errMsg, fmtMoney } from '../../../lib/api';
import Field from '../../../components/form-field';
import { ClientPicker } from '../../../components/entity-picker';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

type Option = {
  id: string; sku: string; name: string; brand: string | null;
  salePrice: number; inStock: number; spec: number; count: number; lineTotal: number;
};

function OptionsTable({
  title, icon: Icon, unit, options, selected, onSelect, t,
}: {
  title: string; icon: React.ElementType; unit: string; options: Option[];
  selected: string | null; onSelect: (id: string) => void; t: any;
}) {
  if (options.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Icon className="h-4 w-4 text-primary" /> {title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {options.map((o) => {
          const short = o.inStock < o.count;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onSelect(o.id)}
              className={`flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-2 text-start text-sm transition-colors ${
                selected === o.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{o.name}</span>
                <span className="text-xs text-muted-foreground">{o.sku} · {o.spec} {unit}</span>
              </span>
              <span className="text-xs text-muted-foreground">{t('calculator.needed')}: <b className="text-foreground">{o.count}×</b></span>
              <span className="text-xs">
                {short ? (
                  <Badge variant="destructive">{t('calculator.inStock')}: {o.inStock} — {t('calculator.outOfStock')}</Badge>
                ) : (
                  <Badge variant="success">{t('calculator.inStock')}: {o.inStock}</Badge>
                )}
              </span>
              <span className="tabular-nums font-semibold">{fmtMoney(o.lineTotal)}</span>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default function CalculatorPage() {
  const t = useTranslations();
  const router = useRouter();
  const [form, setForm] = useState({
    monthlyKwh: '600', sunHoursPerDay: '4.5', backupHours: '8', peakLoadKw: '',
    systemType: 'HYBRID', lossFactor: '0.8', tariffPerKwh: '0.20',
  });
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<{ panel: string | null; inverter: string | null; battery: string | null }>({ panel: null, inverter: null, battery: null });
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [client, setClient] = useState<any>(null);

  const calculate = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/solar-calculator/size', {
        monthlyKwh: Number(form.monthlyKwh),
        sunHoursPerDay: Number(form.sunHoursPerDay),
        backupHours: Number(form.backupHours),
        peakLoadKw: form.peakLoadKw ? Number(form.peakLoadKw) : undefined,
        systemType: form.systemType,
        lossFactor: Number(form.lossFactor),
        tariffPerKwh: Number(form.tariffPerKwh),
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

  const createQuotation = async () => {
    try {
      const { data } = await api.post('/quotations', {
        clientId: client.id,
        notes: `Solar calculator: ${form.monthlyKwh} kWh/month, ${result.sizing.requiredArrayKw} kWp array, ${form.systemType}`,
        items: chosen.map((o) => ({
          productId: o.id,
          quantity: o.count,
          unitPrice: o.salePrice,
        })),
      });
      toast.success(`${t('calculator.quotationCreated')}: ${data.number}`);
      setQuoteOpen(false);
      router.push('/quotations');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('calculator.title')} subtitle={t('calculator.subtitle')} />

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            <Field label={t('calculator.monthlyKwh')}>
              <Input type="number" value={form.monthlyKwh} onChange={(e) => setForm({ ...form, monthlyKwh: e.target.value })} />
            </Field>
            <Field label={t('calculator.sunHours')}>
              <Input type="number" step="0.1" value={form.sunHoursPerDay} onChange={(e) => setForm({ ...form, sunHoursPerDay: e.target.value })} />
            </Field>
            <Field label={t('calculator.backupHours')}>
              <Input type="number" value={form.backupHours} onChange={(e) => setForm({ ...form, backupHours: e.target.value })} />
            </Field>
            <Field label={t('calculator.peakLoad')}>
              <Input type="number" step="0.1" value={form.peakLoadKw} onChange={(e) => setForm({ ...form, peakLoadKw: e.target.value })} />
            </Field>
            <Field label={t('installations.systemType')}>
              <Select value={form.systemType} onChange={(e) => setForm({ ...form, systemType: e.target.value })}>
                {['ON_GRID', 'OFF_GRID', 'HYBRID'].map((x) => <option key={x} value={x}>{t(`installations.${x}`)}</option>)}
              </Select>
            </Field>
            <Field label={t('calculator.lossFactor')}>
              <Select value={form.lossFactor} onChange={(e) => setForm({ ...form, lossFactor: e.target.value })}>
                <option value="0.75">75%</option>
                <option value="0.8">80%</option>
                <option value="0.85">85%</option>
                <option value="0.9">90%</option>
              </Select>
            </Field>
            <Field label={t('calculator.tariff')}>
              <Input type="number" step="0.01" value={form.tariffPerKwh} onChange={(e) => setForm({ ...form, tariffPerKwh: e.target.value })} />
            </Field>
          </div>
          <Button className="mt-4" onClick={calculate} disabled={busy || !form.monthlyKwh}>
            <Calculator /> {t('calculator.calculate')}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{t('calculator.dailyUse')}</div>
              <div className="text-xl font-bold">{result.sizing.dailyKwh} kWh</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{t('calculator.requiredArray')}</div>
              <div className="text-xl font-bold">{result.sizing.requiredArrayKw} kWp</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{t('calculator.requiredInverter')}</div>
              <div className="text-xl font-bold">{result.sizing.requiredInverterKw} kW</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{t('calculator.requiredBackup')}</div>
              <div className="text-xl font-bold">{result.sizing.requiredBackupKwh} kWh</div>
            </CardContent></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <OptionsTable title={t('calculator.panels')} icon={Sun} unit="W" options={result.options.panels} selected={selection.panel} onSelect={(id) => setSelection({ ...selection, panel: id })} t={t} />
              <OptionsTable title={t('calculator.inverters')} icon={Zap} unit="kW" options={result.options.inverters} selected={selection.inverter} onSelect={(id) => setSelection({ ...selection, inverter: id })} t={t} />
              <OptionsTable title={t('calculator.batteries')} icon={BatteryCharging} unit="kWh" options={result.options.batteries} selected={selection.battery} onSelect={(id) => setSelection({ ...selection, battery: id })} t={t} />
            </div>

            <div className="space-y-4">
              <Card className="border-primary/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{t('calculator.recommendedBundle')}</CardTitle>
                </CardHeader>
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
                  <Button className="mt-2 w-full" onClick={() => setQuoteOpen(true)} disabled={chosen.length === 0}>
                    <FileText /> {t('calculator.createQuotation')}
                  </Button>
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
                  <div className="flex justify-between"><span className="text-muted-foreground inline-flex items-center gap-1"><Leaf className="h-3.5 w-3.5 text-green-600" /> {t('calculator.co2PerYear')}</span><span className="tabular-nums font-medium">{result.roi.co2SavedKgPerYear.toLocaleString()} kg</span></div>
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
            <div className="rounded-md border p-3 text-sm">
              {chosen.map((o) => (
                <div key={o.id} className="flex justify-between"><span>{o.count}× {o.name}</span><span className="tabular-nums">{fmtMoney(o.lineTotal)}</span></div>
              ))}
              <div className="mt-1 flex justify-between border-t pt-1 font-bold"><span>{t('common.total')}</span><span className="tabular-nums">{fmtMoney(bundleTotal)}</span></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuoteOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={createQuotation} disabled={!client}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
