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
type DatePreset = 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_YEAR' | 'ALL' | 'CUSTOM';

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

  const presets = [
    { key: 'THIS_MONTH' as const, label: t('clients.thisMonth') || 'This Month' },
    { key: 'LAST_MONTH' as const, label: t('clients.lastMonth') || 'Last Month' },
    { key: 'THIS_YEAR' as const, label: t('clients.thisYear') || 'This Year' },
    { key: 'ALL' as const, label: t('clients.allTime') || 'All Time' },
    { key: 'CUSTOM' as const, label: t('clients.custom') || 'Custom' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-[95vw] sm:w-full p-4 sm:p-6 rounded-2xl">
        <DialogHeader className="space-y-1.5 pb-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-sm">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base sm:text-lg font-semibold tracking-tight">
                {t('clients.generateStatement') || 'Statement of Account'}
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-muted-foreground truncate">
                {client.name}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Statement Mode Selection */}
          <div className="space-y-2">
            <Label className="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
              {t('clients.statementMode') || 'Statement Scope & Mode'}
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setMode('FULL')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl border p-3 text-start transition-all cursor-pointer select-none',
                  mode === 'FULL'
                    ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary shadow-sm'
                    : 'border-border/80 bg-card/60 hover:bg-muted/50 text-muted-foreground hover:text-foreground',
                )}
              >
                <div className="flex items-center gap-2 font-medium text-xs sm:text-sm">
                  <FileText className={cn('h-4 w-4 shrink-0', mode === 'FULL' ? 'text-primary' : 'text-muted-foreground')} />
                  <span className="font-semibold">{t('clients.modeFull') || 'Full Account Statement'}</span>
                </div>
                <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                  {t('clients.modeFullDesc') || 'Invoices, payments & running balance ledger.'}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setMode('PAYMENTS')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl border p-3 text-start transition-all cursor-pointer select-none',
                  mode === 'PAYMENTS'
                    ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary shadow-sm'
                    : 'border-border/80 bg-card/60 hover:bg-muted/50 text-muted-foreground hover:text-foreground',
                )}
              >
                <div className="flex items-center gap-2 font-medium text-xs sm:text-sm">
                  <Receipt className={cn('h-4 w-4 shrink-0', mode === 'PAYMENTS' ? 'text-primary' : 'text-muted-foreground')} />
                  <span className="font-semibold">{t('clients.modePayments') || 'Payment History Only'}</span>
                </div>
                <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                  {t('clients.modePaymentsDesc') || 'List of payments received with invoice refs.'}
                </p>
              </button>
            </div>
          </div>

          {/* Date Range Selection */}
          <div className="space-y-2.5 rounded-xl border border-border/60 bg-muted/20 p-3 sm:p-3.5">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
                {t('clients.statementPeriod') || 'Date Range'}
              </Label>
              <button
                type="button"
                onClick={handleSetTillToday}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline cursor-pointer"
              >
                <Sparkles className="h-3 w-3" />
                {t('clients.tillToday') || 'Till Today'}
              </button>
            </div>

            {/* Presets Chips */}
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => {
                const isActive = preset === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => handlePresetChange(p.key)}
                    className={cn(
                      'px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-background hover:bg-muted text-muted-foreground hover:text-foreground border border-border/70',
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* From - To Date Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{t('clients.fromDate') || 'From Date'}</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setPreset('CUSTOM');
                  }}
                  className="h-9 text-xs sm:text-sm bg-background"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{t('clients.toDate') || 'To Date'}</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setPreset('CUSTOM');
                  }}
                  className="h-9 text-xs sm:text-sm bg-background"
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="pt-2 gap-2 sm:gap-2 flex-col-reverse sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={downloading || printing}
            className="w-full sm:w-auto text-xs sm:text-sm h-9"
          >
            {t('common.cancel')}
          </Button>
          <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              onClick={handlePrint}
              disabled={downloading || printing}
              className="w-full sm:w-auto text-xs sm:text-sm h-9 gap-1.5"
            >
              {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              {t('clients.printStatement') || 'Print / Preview'}
            </Button>
            <Button
              type="button"
              onClick={handleDownload}
              disabled={downloading || printing}
              className="w-full sm:w-auto text-xs sm:text-sm h-9 gap-1.5"
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
