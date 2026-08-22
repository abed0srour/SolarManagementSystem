'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Calendar, Download, FileSpreadsheet, FileText, Loader2, Printer, Receipt, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { downloadFile, openPdf, errMsg } from '../lib/api';
import { cn } from '../lib/utils';

type StatementMode = 'FULL' | 'PAYMENTS';
type DatePreset = 'ALL' | 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_YEAR' | 'CUSTOM';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: {
    id: string;
    name: string;
  };
}

function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getPresetDates(preset: DatePreset): { startDate: string; endDate: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = getTodayString();

  if (preset === 'THIS_MONTH') {
    const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return { startDate: start, endDate: today };
  }
  if (preset === 'LAST_MONTH') {
    const lastMonthStart = new Date(y, m - 1, 1);
    const lastMonthEnd = new Date(y, m, 0);
    const start = `${lastMonthStart.getFullYear()}-${String(lastMonthStart.getMonth() + 1).padStart(2, '0')}-01`;
    const end = `${lastMonthEnd.getFullYear()}-${String(lastMonthEnd.getMonth() + 1).padStart(2, '0')}-${String(lastMonthEnd.getDate()).padStart(2, '0')}`;
    return { startDate: start, endDate: end };
  }
  if (preset === 'THIS_YEAR') {
    const start = `${y}-01-01`;
    return { startDate: start, endDate: today };
  }
  return { startDate: '', endDate: '' };
}

export default function ClientStatementDialog({ open, onOpenChange, client }: Props) {
  const t = useTranslations();
  const [mode, setMode] = useState<StatementMode>('FULL');
  const [preset, setPreset] = useState<DatePreset>('THIS_MONTH');
  const initialDates = getPresetDates('THIS_MONTH');
  const [startDate, setStartDate] = useState(initialDates.startDate);
  const [endDate, setEndDate] = useState(initialDates.endDate);
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);

  const handlePresetChange = (nextPreset: DatePreset) => {
    setPreset(nextPreset);
    if (nextPreset !== 'CUSTOM') {
      const { startDate: s, endDate: e } = getPresetDates(nextPreset);
      setStartDate(s);
      setEndDate(e);
    }
  };

  const handleSetTillToday = () => {
    setEndDate(getTodayString());
    setPreset('CUSTOM');
  };

  const buildUrl = () => {
    const params = new URLSearchParams();
    params.set('mode', mode);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    return `/clients/${client.id}/statement-pdf?${params.toString()}`;
  };

  const getFilename = () => {
    const dateStr = getTodayString();
    const cleanName = client.name.replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, '_');
    return `statement-${cleanName}-${mode.toLowerCase()}-${dateStr}.pdf`;
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadFile(buildUrl(), getFilename());
      toast.success(t('clients.statementDownloaded') || 'Statement downloaded successfully');
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = async () => {
    setPrinting(true);
    try {
      await openPdf(buildUrl());
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg">
                {t('clients.generateStatement') || 'Statement of Account'}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {client.name}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Statement Mode Selection */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">
              {t('clients.statementMode') || 'Statement Mode / Scope'}
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setMode('FULL')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl border p-3 text-start transition-all',
                  mode === 'FULL'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border bg-card hover:bg-accent/50',
                )}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <FileText className={cn('h-4 w-4', mode === 'FULL' ? 'text-primary' : 'text-muted-foreground')} />
                  <span>{t('clients.modeFull') || 'Full Account Statement'}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t('clients.modeFullDesc') || 'All invoices, payments and running balance.'}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setMode('PAYMENTS')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl border p-3 text-start transition-all',
                  mode === 'PAYMENTS'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border bg-card hover:bg-accent/50',
                )}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <Receipt className={cn('h-4 w-4', mode === 'PAYMENTS' ? 'text-primary' : 'text-muted-foreground')} />
                  <span>{t('clients.modePayments') || 'Payment History Only'}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t('clients.modePaymentsDesc') || 'List of received payments and invoice references.'}
                </p>
              </button>
            </div>
          </div>

          {/* Date Range Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">
                {t('clients.statementPeriod') || 'Date Range'}
              </Label>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-6 text-xs gap-1 px-2 font-medium text-primary bg-primary/10 hover:bg-primary/20"
                onClick={handleSetTillToday}
              >
                <Sparkles className="h-3 w-3" />
                {t('clients.tillToday') || 'Till Today'}
              </Button>
            </div>

            {/* Presets */}
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['THIS_MONTH', t('reports.thisMonth') || 'This Month'],
                  ['LAST_MONTH', t('reports.lastMonth') || 'Last Month'],
                  ['THIS_YEAR', t('reports.thisYear') || 'This Year'],
                  ['ALL', t('common.allTime') || 'All Time'],
                  ['CUSTOM', t('reports.custom') || 'Custom'],
                ] as const
              ).map(([pKey, pLabel]) => (
                <Button
                  key={pKey}
                  type="button"
                  size="sm"
                  variant={preset === pKey ? 'default' : 'outline'}
                  className="h-7 text-xs"
                  onClick={() => handlePresetChange(pKey)}
                >
                  {pLabel}
                </Button>
              ))}
            </div>

            {/* From - To Date Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t('clients.fromDate') || 'From Date'}</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setPreset('CUSTOM');
                  }}
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">{t('clients.toDate') || 'To Date'}</Label>
                  <button
                    type="button"
                    onClick={handleSetTillToday}
                    className="text-[11px] text-primary hover:underline"
                  >
                    {t('clients.tillToday') || 'Today'}
                  </button>
                </div>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setPreset('CUSTOM');
                  }}
                />
              </div>
            </div>

            {startDate || endDate ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-lg">
                <Calendar className="h-3.5 w-3.5" />
                <span>
                  {startDate || 'Start'} &nbsp;→&nbsp; {endDate || 'Today'}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-lg">
                <Calendar className="h-3.5 w-3.5" />
                <span>{t('clients.allTransactions') || 'All recorded transactions included'}</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={downloading || printing}>
            {t('common.cancel')}
          </Button>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              onClick={handlePrint}
              disabled={downloading || printing}
              className="flex-1 sm:flex-initial"
            >
              {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              {t('clients.printStatement') || 'Print / Preview'}
            </Button>
            <Button
              type="button"
              onClick={handleDownload}
              disabled={downloading || printing}
              className="flex-1 sm:flex-initial"
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {t('common.downloadPdf') || 'Download PDF'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
