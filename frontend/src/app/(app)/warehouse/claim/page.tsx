'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { PackageCheck, ScanLine, Search, AlertTriangle, CheckCircle2 } from 'lucide-react';
import PageHeader from '../../../../components/page-header';
import { api, errMsg, fmtMoney, fmtDateTime } from '../../../../lib/api';
import { invalidateCache } from '../../../../lib/cache';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Badge } from '../../../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/ui/table';

/**
 * Warehouse counter: type or scan the code from a customer's receipt, check the
 * order on screen, hand the goods over.
 *
 * A barcode scanner behaves as a keyboard that types the code and presses
 * Enter, so the plain input doubles as the scanner target with no extra work.
 */
export default function ClaimPage() {
  const t = useTranslations();
  const [code, setCode] = useState('');
  const [order, setOrder] = useState<any>(null);
  const [looking, setLooking] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const lookup = async (value?: string) => {
    const c = (value ?? code).trim();
    if (!c) return;
    setLooking(true);
    setOrder(null);
    try {
      const { data } = await api.get(`/sales-orders/pickup/${encodeURIComponent(c)}`);
      setOrder(data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLooking(false);
    }
  };

  const claim = async () => {
    setClaiming(true);
    try {
      const { data } = await api.post(`/sales-orders/pickup/${encodeURIComponent(order.pickupCode)}/claim`, {});
      invalidateCache('sales-orders');
      toast.success(t('claim.released', { number: data.number }));
      // Clear down and refocus, ready for the next customer.
      setOrder(null);
      setCode('');
      inputRef.current?.focus();
    } catch (e) {
      toast.error(errMsg(e));
      // Re-read so the screen shows why (e.g. someone else just claimed it).
      lookup(order.pickupCode);
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PackageCheck} title={t('claim.title')} subtitle={t('claim.subtitle')} />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-full sm:w-auto flex-1 min-w-[200px]">
              <label className="mb-1.5 block text-sm font-medium">{t('claim.codeLabel')}</label>
              <div className="relative">
                <ScanLine className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={inputRef}
                  autoFocus
                  dir="ltr"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && lookup()}
                  placeholder="XXXXXXXX"
                  className="ps-8 font-mono text-lg tracking-[0.25em]"
                />
              </div>
            </div>
            <Button onClick={() => lookup()} disabled={looking || !code.trim()} className="w-full sm:w-auto">
              <Search /> {looking ? t('common.loading') : t('claim.lookup')}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('claim.scanHint')}</p>
        </CardContent>
      </Card>

      {order && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="flex items-center gap-2">
              {order.claimable ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              )}
              {order.number}
            </CardTitle>
            <Badge variant={order.claimable ? 'success' : 'destructive'}>
              {order.claimable ? t('claim.readyToRelease') : order.reason}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div><span className="text-muted-foreground">{t('common.client')}: </span><span className="font-medium">{order.client?.name}</span></div>
              <div><span className="text-muted-foreground">{t('common.phone')}: </span>{order.client?.phone ?? '—'}</div>
              <div><span className="text-muted-foreground">{t('common.warehouse')}: </span>{order.warehouse?.name}</div>
              <div><span className="text-muted-foreground">{t('common.total')}: </span><span className="font-medium">{fmtMoney(order.total)}</span></div>
              {order.claimedAt && (
                <div className="sm:col-span-2 text-muted-foreground">
                  {t('claim.collectedOn')}: {fmtDateTime(order.claimedAt)}
                  {order.claimedBy?.name ? ` — ${order.claimedBy.name}` : ''}
                </div>
              )}
            </div>

            {/* Unpaid balance is a warning, not a block — releasing goods on
                credit is a business decision, so it is surfaced not enforced. */}
            {Number(order.outstanding) > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {t('claim.outstandingWarning', { amount: fmtMoney(order.outstanding) })}
              </div>
            )}

            {/* Pick-list: bundles expanded, because the warehouse must collect
                every component even though the customer saw one line. */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.product')}</TableHead>
                  <TableHead className="w-24 text-end">{t('common.quantity')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items?.map((i: any) => (
                  <>
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">
                        {i.description ?? i.product?.name}
                        {i.product?.sku && <span className="ms-2 font-mono text-xs text-muted-foreground">{i.product.sku}</span>}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{Number(i.quantity)}</TableCell>
                    </TableRow>
                    {i.subItems?.map((s: any) => (
                      <TableRow key={s.id} className="bg-muted/20">
                        <TableCell className="ps-8 text-sm text-muted-foreground">
                          • {s.description ?? s.product?.name}
                        </TableCell>
                        <TableCell className="text-end text-sm tabular-nums text-muted-foreground">
                          {Number(s.quantity)} {s.unit ?? ''}
                        </TableCell>
                      </TableRow>
                    ))}
                  </>
                ))}
              </TableBody>
            </Table>

            <Button className="w-full" disabled={!order.claimable || claiming} onClick={claim}>
              <PackageCheck /> {claiming ? t('common.loading') : t('claim.release')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
