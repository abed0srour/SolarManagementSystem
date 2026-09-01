'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ScrollText as PageIcon, Search, TrendingDown, TrendingUp } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import StatusChip from '../../../components/status-chip';
import EntityLink from '../../../components/entity-link';
import Field from '../../../components/form-field';
import { ProductPicker, SupplierPicker } from '../../../components/entity-picker';
import { api, errMsg, fmtDate, fmtDateTime, fmtMoney } from '../../../lib/api';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Textarea } from '../../../components/ui/textarea';

const STATUSES = ['IN_STOCK', 'RESERVED', 'SOLD', 'RETURNED', 'DAMAGED', 'RETURNED_TO_SUPPLIER'];

export default function ProductHistoryPage() {
  const t = useTranslations();

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('productHistory.title')} subtitle={t('subtitles.productHistory')} />
      <Tabs defaultValue="purchases">
        <TabsList className="w-full sm:w-auto flex flex-wrap h-auto p-1 gap-1">
          <TabsTrigger value="purchases">{t('productHistory.purchaseHistory')}</TabsTrigger>
          <TabsTrigger value="units">{t('productHistory.serialLookup')}</TabsTrigger>
        </TabsList>
        <TabsContent value="purchases">
          <PurchaseHistory />
        </TabsContent>
        <TabsContent value="units">
          <SerialLookup />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Who has supplied a product, at what price, and how that price has moved. */
function PurchaseHistory() {
  const t = useTranslations();
  const [product, setProduct] = useState<any>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [costHistory, setCostHistory] = useState<any[] | null>(null);
  const [costHistoryLoading, setCostHistoryLoading] = useState(false);

  useEffect(() => {
    if (!product) {
      setData(null);
      return;
    }
    setLoading(true);
    api
      .get(`/product-history/products/${product.id}/purchases`)
      .then((r) => setData(r.data))
      .catch((e) => {
        toast.error(errMsg(e));
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [product]);

  // Fetched separately from the purchase history: this is the audit trail of
  // the product's actual weighted-average costPrice changing (see
  // applyWeightedAverageCost), not the raw unit cost on each purchase order —
  // kept independent so a hiccup here never blows away the purchase data above.
  useEffect(() => {
    if (!product) {
      setCostHistory(null);
      return;
    }
    setCostHistoryLoading(true);
    api
      .get(`/products/${product.id}/price-history`)
      .then((r) => setCostHistory(r.data))
      .catch((e) => {
        toast.error(errMsg(e));
        setCostHistory(null);
      })
      .finally(() => setCostHistoryLoading(false));
  }, [product]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <Field label={t('common.product')}>
            <div className="max-w-sm">
              <ProductPicker value={product} onChange={setProduct} />
            </div>
          </Field>
        </CardContent>
      </Card>

      {loading && <Skeleton className="h-64" />}

      {!loading && !product && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t('productHistory.pickProduct')}
        </div>
      )}

      {!loading && data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label={t('productHistory.orders')} value={String(data.totals.orders)} />
            <Kpi label={t('productHistory.unitsBought')} value={String(data.totals.quantity)} />
            <Kpi label={t('productHistory.totalSpend')} value={fmtMoney(data.totals.spend)} />
            <Kpi label={t('productHistory.averageUnitCost')} value={fmtMoney(data.totals.averageUnitCost)} />
          </div>

          <Card>
            <CardHeader><CardTitle>{t('productHistory.costPriceHistory')}</CardTitle></CardHeader>
            <CardContent>
              {costHistoryLoading ? (
                <Skeleton className="h-24" />
              ) : !costHistory?.length ? (
                <p className="text-sm text-muted-foreground">{t('productHistory.noCostChanges')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('common.date')}</TableHead>
                        <TableHead>{t('products.costPrice')} ({t('products.oldToNew')})</TableHead>
                        <TableHead>{t('products.salePrice')} ({t('products.oldToNew')})</TableHead>
                        <TableHead>{t('products.reason')}</TableHead>
                        <TableHead>{t('products.changedBy')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {costHistory.map((h: any) => (
                        <TableRow key={h.id}>
                          <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(h.createdAt)}</TableCell>
                          <TableCell className="tabular-nums">
                            {h.oldCostPrice != null ? fmtMoney(h.oldCostPrice) : '—'} → {h.newCostPrice != null ? fmtMoney(h.newCostPrice) : '—'}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {h.oldSalePrice != null ? fmtMoney(h.oldSalePrice) : '—'} → {h.newSalePrice != null ? fmtMoney(h.newSalePrice) : '—'}
                          </TableCell>
                          <TableCell className="max-w-xs truncate" title={h.reason ?? undefined}>{h.reason ?? '—'}</TableCell>
                          <TableCell>{h.changedBy?.name ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {data.purchases.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              {t('productHistory.neverPurchased')}
            </div>
          ) : (
            <>
              <Card>
                <CardHeader><CardTitle>{t('productHistory.bySupplier')}</CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('common.supplier')}</TableHead>
                          <TableHead className="text-end">{t('productHistory.orders')}</TableHead>
                          <TableHead className="text-end">{t('common.quantity')}</TableHead>
                          <TableHead className="text-end">{t('productHistory.received')}</TableHead>
                          <TableHead className="text-end">{t('productHistory.returned')}</TableHead>
                          <TableHead className="text-end">{t('productHistory.costRange')}</TableHead>
                          <TableHead className="text-end">{t('productHistory.totalSpend')}</TableHead>
                          <TableHead className="text-end">{t('productHistory.lastOrder')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.suppliers.map((s: any) => (
                          <TableRow key={s.supplierId}>
                            <TableCell className="font-medium">{s.supplierName}</TableCell>
                            <TableCell className="text-end tabular-nums">{s.orders}</TableCell>
                            <TableCell className="text-end tabular-nums">{s.quantity}</TableCell>
                            <TableCell className="text-end tabular-nums">{s.received}</TableCell>
                            <TableCell className="text-end tabular-nums">
                              {s.returned > 0 ? (
                                <span className="font-semibold text-amber-600 dark:text-amber-400">{s.returned}</span>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell className="text-end tabular-nums">
                              {s.lowestCost === s.highestCost
                                ? fmtMoney(s.lowestCost)
                                : `${fmtMoney(s.lowestCost)} – ${fmtMoney(s.highestCost)}`}
                            </TableCell>
                            <TableCell className="text-end tabular-nums font-medium">{fmtMoney(s.spend)}</TableCell>
                            <TableCell className="text-end whitespace-nowrap">{fmtDate(s.lastOrderDate)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>{t('productHistory.priceTrend')}</CardTitle></CardHeader>
                <CardContent>
                  <PriceTrend trend={data.trend} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>{t('productHistory.everyPurchase')}</CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('orders.purchaseTitle')}</TableHead>
                          <TableHead>{t('common.supplier')}</TableHead>
                          <TableHead className="text-end">{t('common.quantity')}</TableHead>
                          <TableHead className="text-end">{t('productHistory.unitCost')}</TableHead>
                          <TableHead className="text-end">{t('common.lineTotal')}</TableHead>
                          <TableHead>{t('productHistory.invoices')}</TableHead>
                          <TableHead className="text-end">{t('common.date')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.purchases.map((p: any) => (
                          <TableRow key={p.purchaseOrderId}>
                            <TableCell>
                              <EntityLink href={`/purchase-orders/${p.purchaseOrderId}/edit`} mono>
                                {p.number}
                              </EntityLink>
                            </TableCell>
                            <TableCell>{p.supplierName}</TableCell>
                            <TableCell className="text-end tabular-nums">
                              {p.receivedQty}/{p.quantity}
                            </TableCell>
                            <TableCell className="text-end tabular-nums">{fmtMoney(p.unitCost)}</TableCell>
                            <TableCell className="text-end tabular-nums font-medium">{fmtMoney(p.lineTotal)}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {p.invoices.length ? p.invoices.map((i: any) => i.number).join(', ') : '—'}
                            </TableCell>
                            <TableCell className="text-end whitespace-nowrap">{fmtDate(p.orderDate)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Unit cost over time, oldest first, with the move against the purchase before.
 *
 * A bar chart of absolute cost hides what matters — a 2% rise and a 40% rise
 * look nearly identical at these scales — so the change is stated rather than
 * drawn.
 */
function PriceTrend({ trend }: { trend: any[] }) {
  const t = useTranslations();
  if (!trend.length) return <p className="text-sm text-muted-foreground">{t('productHistory.neverPurchased')}</p>;

  return (
    <ul className="divide-y">
      {[...trend].reverse().map((point, i) => (
        <li key={`${point.purchaseOrderId}-${i}`} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-medium">{fmtMoney(point.unitCost)}</div>
            <div className="text-xs text-muted-foreground">
              {point.supplier} · {fmtDate(point.date)}
            </div>
          </div>
          {point.change === null ? (
            <span className="text-xs text-muted-foreground">{t('productHistory.firstPurchase')}</span>
          ) : point.change === 0 ? (
            <span className="text-xs text-muted-foreground">{t('productHistory.unchanged')}</span>
          ) : (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs font-medium tabular-nums',
                point.change > 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400',
              )}
            >
              {point.change > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {point.change > 0 ? '+' : ''}
              {fmtMoney(point.change)}
              {point.changePct !== null && ` (${point.changePct > 0 ? '+' : ''}${point.changePct}%)`}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Find a unit and trace it back to whoever supplied it.
 *
 * The serial box is first and submits on Enter, because the overwhelmingly
 * common arrival is someone holding a failed unit with its number in hand.
 */
function SerialLookup() {
  const t = useTranslations();
  const [serial, setSerial] = useState('');
  const [product, setProduct] = useState<any>(null);
  const [supplier, setSupplier] = useState<any>(null);
  const [status, setStatus] = useState('');
  const [faultyOnly, setFaultyOnly] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/product-history/units', {
        params: {
          serial: serial.trim() || undefined,
          productId: product?.id,
          supplierId: supplier?.id,
          status: status || undefined,
          faultyOnly: faultyOnly ? 'true' : undefined,
          pageSize: 100,
        },
      });
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [serial, product, supplier, status, faultyOnly]);

  useEffect(() => {
    search();
  }, [search]);

  const openDetail = async (id: string) => {
    try {
      const { data } = await api.get(`/product-history/units/${id}`);
      setDetail(data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('inventory.serialNumber')}>
            <div className="relative">
              <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                dir="ltr"
                className="ps-8 font-mono text-xs"
                placeholder={t('productHistory.serialPlaceholder')}
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
              />
            </div>
          </Field>
          <Field label={t('common.product')}>
            <ProductPicker value={product} onChange={setProduct} />
          </Field>
          <Field label={t('common.supplier')}>
            <SupplierPicker value={supplier} onChange={setSupplier} />
          </Field>
          <Field label={t('common.status')}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{t(`status.${s}`)}</option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-4">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={faultyOnly}
              onChange={(e) => {
                setFaultyOnly(e.target.checked);
                if (e.target.checked) setStatus('');
              }}
            />
            {t('productHistory.faultyOnly')}
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('productHistory.unitsFound', { count: total })}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-40" />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('common.noRecords')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('inventory.serialNumber')}</TableHead>
                    <TableHead>{t('common.product')}</TableHead>
                    <TableHead>{t('common.supplier')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('serials.source')}</TableHead>
                    <TableHead className="text-end">{t('common.date')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((u) => (
                    <TableRow key={u.id} className="cursor-pointer" onClick={() => openDetail(u.id)}>
                      <TableCell className="font-mono text-xs" dir="ltr">{u.serialNumber}</TableCell>
                      <TableCell>
                        <div className="font-medium">{u.product?.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{u.product?.sku}</div>
                      </TableCell>
                      <TableCell>
                        {u.purchaseOrder?.supplier?.name ?? (
                          <span className="text-xs text-muted-foreground">{t('productHistory.supplierUnknown')}</span>
                        )}
                      </TableCell>
                      <TableCell><StatusChip status={u.status} /></TableCell>
                      <TableCell className="font-mono text-xs">{u.purchaseOrder?.number ?? '—'}</TableCell>
                      <TableCell className="text-end whitespace-nowrap">{fmtDate(u.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <UnitDetail unit={detail} onClose={() => setDetail(null)} onChanged={(u) => { setDetail(u); search(); }} />
    </div>
  );
}

/** One unit: who supplied it, where it went, and everything that happened to it. */
function UnitDetail({ unit, onClose, onChanged }: { unit: any; onClose: () => void; onChanged: (u: any) => void }) {
  const t = useTranslations();
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus('');
    setNote('');
  }, [unit?.id]);

  const save = async () => {
    if (!status) return;
    setBusy(true);
    try {
      const { data } = await api.patch(`/product-history/units/${unit.id}/status`, { status, note: note || undefined });
      toast.success(t('common.saved'));
      onChanged(data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!unit} onOpenChange={(v) => !v && onClose()}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle className="font-mono" dir="ltr">{unit?.serialNumber}</DialogTitle>
        </DialogHeader>
        {unit && (
          <div className="space-y-5">
            <div className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              <Detail label={t('common.product')} value={`${unit.product?.name} (${unit.product?.sku})`} />
              <Detail label={t('common.status')} value={<StatusChip status={unit.status} />} />
              <Detail
                label={t('common.supplier')}
                value={
                  unit.purchaseOrder?.supplier
                    ? `${unit.purchaseOrder.supplier.name}${unit.purchaseOrder.supplier.phone ? ` · ${unit.purchaseOrder.supplier.phone}` : ''}`
                    : t('productHistory.supplierUnknown')
                }
              />
              <Detail label={t('serials.source')} value={unit.purchaseOrder?.number ?? '—'} />
              <Detail label={t('nav.salesOrders')} value={unit.salesOrder?.number ?? '—'} />
              <Detail label={t('common.client')} value={unit.salesOrder?.client?.name ?? '—'} />
              <Detail label={t('inventory.warehouses')} value={unit.warehouse?.name ?? '—'} />
              <Detail
                label={t('warranty.warrantyEnd')}
                value={unit.warrantyEndDate ? fmtDate(unit.warrantyEndDate) : '—'}
              />
            </div>

            <div>
              <div className="mb-1.5 text-sm font-medium">{t('productHistory.lifecycle')}</div>
              {unit.events?.length ? (
                <ul className="divide-y rounded-md border">
                  {unit.events.map((e: any) => (
                    <li key={e.id} className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>
                          {e.fromStatus ? `${t(`status.${e.fromStatus}`)} → ` : ''}
                          <StatusChip status={e.toStatus} />
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {fmtDate(e.createdAt)}{e.user?.name ? ` · ${e.user.name}` : ''}
                        </span>
                      </div>
                      {e.note && <p className="mt-1 text-xs text-muted-foreground">{e.note}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  {t('productHistory.noEvents')}
                </p>
              )}
            </div>

            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="text-sm font-medium">{t('productHistory.changeStatus')}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">{t('productHistory.pickStatus')}</option>
                  {STATUSES.filter((s) => s !== unit.status).map((s) => (
                    <option key={s} value={s}>{t(`status.${s}`)}</option>
                  ))}
                </Select>
                <Textarea
                  rows={2}
                  placeholder={t('productHistory.notePlaceholder')}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <div className="flex justify-end">
                <Button size="sm" disabled={!status || busy} onClick={save}>
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="sm:text-end">{value}</span>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
