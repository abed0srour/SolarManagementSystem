'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { invalidateCache } from '../lib/cache';
import { cn } from '../lib/utils';
import Field from './form-field';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Textarea } from './ui/textarea';
import { Skeleton } from './ui/skeleton';

const COLS = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4' } as const;

/** Titled panel of fields, matching the product form so the two read alike. */
function Section({
  title, children, cols = 4, note,
}: { title: string; children: React.ReactNode; cols?: keyof typeof COLS; note?: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b bg-muted/40 px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      </div>
      <div className={cn('grid grid-cols-1 gap-x-4 gap-y-4 p-4', cols > 1 && 'sm:grid-cols-2', COLS[cols])}>
        {children}
      </div>
      {/*
        Explanatory text lives under the grid, not as a field hint: a hint sits
        inside its cell and makes that cell taller, which pushes its input out
        of line with the others on the row.
      */}
      {note && <p className="border-t bg-muted/20 px-4 py-2 text-xs text-muted-foreground">{note}</p>}
    </Card>
  );
}

type Errors = Partial<Record<'name' | 'dailyRate' | 'hourlyRate', string>>;

export default function WorkerForm({ workerId }: { workerId?: string }) {
  const t = useTranslations();
  const router = useRouter();
  const editing = Boolean(workerId);

  const [form, setForm] = useState<any>({
    name: '', jobTitle: '', phone: '', email: '', payBasis: 'DAILY',
    dailyRate: 0, hourlyRate: 0, expectedHoursPerDay: 8, lateDeductionPerHour: 0,
    payPeriod: 'MONTHLY', hiredOn: '', notes: '',
  });
  const [loading, setLoading] = useState(editing);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (!workerId) return;
    let cancelled = false;
    api
      .get(`/workers/${workerId}`)
      .then((r) => {
        if (cancelled) return;
        const w = r.data;
        setForm({
          name: w.name, jobTitle: w.jobTitle ?? '', phone: w.phone ?? '', email: w.email ?? '',
          payBasis: w.payBasis, dailyRate: Number(w.dailyRate), hourlyRate: Number(w.hourlyRate),
          expectedHoursPerDay: Number(w.expectedHoursPerDay), lateDeductionPerHour: Number(w.lateDeductionPerHour),
          payPeriod: w.payPeriod, hiredOn: w.hiredOn ? String(w.hiredOn).slice(0, 10) : '', notes: w.notes ?? '',
        });
      })
      .catch(() => !cancelled && setNotFound(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [workerId]);

  const validate = (): Errors => {
    const next: Errors = {};
    if (!String(form.name).trim()) next.name = t('validation.required');
    // Whichever rate actually drives this worker's pay must be usable.
    if (form.payBasis === 'DAILY' && Number(form.dailyRate) < 0) next.dailyRate = t('validation.positiveNumber');
    if (form.payBasis === 'HOURLY' && Number(form.hourlyRate) < 0) next.hourlyRate = t('validation.positiveNumber');
    return next;
  };

  const save = async () => {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error(t('validation.fixErrors'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        dailyRate: Number(form.dailyRate) || 0,
        hourlyRate: Number(form.hourlyRate) || 0,
        expectedHoursPerDay: Number(form.expectedHoursPerDay) || 8,
        lateDeductionPerHour: Number(form.lateDeductionPerHour) || 0,
        jobTitle: form.jobTitle || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        hiredOn: form.hiredOn || undefined,
        notes: form.notes || undefined,
      };
      if (editing) await api.patch(`/workers/${workerId}`, payload);
      else await api.post('/workers', payload);
      invalidateCache('workers');
      toast.success(t('common.saved'));
      router.push('/workers');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm font-medium">{t('workers.notFound')}</p>
        <Button variant="outline" onClick={() => router.push('/workers')}>
          <ArrowLeft className="rtl:rotate-180" /> {t('workers.backToWorkers')}
        </Button>
      </div>
    );
  }

  const err = (k: keyof Errors) => errors[k];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <Section title={t('workers.sectionProfile')} cols={2}>
        <Field label={t('common.name')} hint={err('name')}>
          <Input
            className={cn(err('name') && 'border-destructive')}
            placeholder="e.g. Ali Ahmad"
            value={form.name ?? ''}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label={t('workers.jobTitle')}>
          <Input placeholder="e.g. Senior Solar Technician" value={form.jobTitle ?? ''} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
        </Field>
        <Field label={t('common.phone')}>
          <Input dir="ltr" placeholder="e.g. +961 71 234 567" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label={t('common.email')}>
          <Input type="email" dir="ltr" placeholder="e.g. ali@company.com" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label={t('workers.hiredOn')}>
          <Input type="date" value={form.hiredOn ?? ''} onChange={(e) => setForm({ ...form, hiredOn: e.target.value })} />
        </Field>
      </Section>

      <Section title={t('workers.sectionPay')} cols={3} note={t('workers.lateDeductionHint')}>
        <Field label={t('workers.payBasis')}>
          <Select value={form.payBasis} onChange={(e) => setForm({ ...form, payBasis: e.target.value })}>
            <option value="DAILY">{t('workers.daily')}</option>
            <option value="HOURLY">{t('workers.hourly')}</option>
          </Select>
        </Field>

        {/* Only the rate that actually pays this worker is shown — offering both
            invites setting one and being paid by the other. */}
        {form.payBasis === 'HOURLY' ? (
          <>
            <Field label={t('workers.hourlyRate')} hint={err('hourlyRate')}>
              <Input
                type="number" min={0} step="0.01"
                placeholder="0.00"
                className={cn('text-end tabular-nums', err('hourlyRate') && 'border-destructive')}
                value={form.hourlyRate ?? ''}
                onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
              />
            </Field>
            <Field label={t('workers.expectedHours')}>
              <Input
                type="number" min={0} step="0.5" className="text-end tabular-nums"
                placeholder="8"
                value={form.expectedHoursPerDay ?? ''}
                onChange={(e) => setForm({ ...form, expectedHoursPerDay: e.target.value })}
              />
            </Field>
          </>
        ) : (
          <Field label={t('workers.dailyRate')} hint={err('dailyRate')}>
            <Input
              type="number" min={0} step="0.01"
              placeholder="0.00"
              className={cn('text-end tabular-nums', err('dailyRate') && 'border-destructive')}
              value={form.dailyRate ?? ''}
              onChange={(e) => setForm({ ...form, dailyRate: e.target.value })}
            />
          </Field>
        )}

        <Field label={t('workers.lateDeduction')}>
          <Input
            type="number" min={0} step="0.01" className="text-end tabular-nums"
            placeholder="0.00"
            value={form.lateDeductionPerHour ?? ''}
            onChange={(e) => setForm({ ...form, lateDeductionPerHour: e.target.value })}
          />
        </Field>
        <Field label={t('workers.payPeriod')}>
          <Select value={form.payPeriod} onChange={(e) => setForm({ ...form, payPeriod: e.target.value })}>
            <option value="WEEKLY">{t('workers.weekly')}</option>
            <option value="MONTHLY">{t('workers.monthly')}</option>
          </Select>
        </Field>
      </Section>

      <Section title={t('common.notes')} cols={1}>
        <Textarea rows={3} placeholder="Optional notes about the worker..." value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Section>

      <div className="sticky bottom-0 flex items-center justify-end gap-2 rounded-lg border bg-card/90 px-4 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => router.push('/workers')} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
