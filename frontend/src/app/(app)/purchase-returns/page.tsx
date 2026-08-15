'use client';
import { Undo2 as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api, errMsg, fmtDate, fmtMoney } from '../../../lib/api';
import DataTable from '../../../components/data-table';
import StatusChip from '../../../components/status-chip';
import EntityLink from '../../../components/entity-link';
import Field from '../../../components/form-field';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

export default function PurchaseReturnsPage() {
  const t = useTranslations();
  const [refreshKey, setRefreshKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [form, setForm] = useState<any>({});

  const openDetail = async (row: any) => {
    try {
      const { data } = await api.get(`/purchase-returns/${row.id}`);
      setDetail(data);
      setForm({ status: data.status, creditNoteRef: data.creditNoteRef ?? '' });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const saveStatus = async () => {
    try {
      await api.post(`/purchase-returns/${detail.id}/status`, {
        status: form.status,
        creditNoteRef: form.creditNoteRef || undefined,
      });
      toast.success(t('common.saved'));
      setDetail(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('purchaseReturns.title')} subtitle={t('subtitles.purchaseReturns')} />
      <DataTable
        endpoint="/purchase-returns"
        refreshKey={refreshKey}
        extraParams={statusFilter ? { status: statusFilter } : {}}
        onRowClick={openDetail}
        filters={
          <Select className="w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {['PENDING', 'SENT', 'CREDITED', 'REPLACED', 'CLOSED'].map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        }
        columns={[
          {
            key: 'number',
            label: t('quotations.number'),
            className: 'w-28',
            render: (r) => <span className="font-mono text-xs">{r.number}</span>,
          },
          { key: 'supplier', label: t('common.supplier'), render: (r) => r.supplier?.name },
          {
            key: 'purchaseOrder',
            label: t('nav.purchaseOrders'),
            className: 'w-32',
            render: (r) => (
              <EntityLink href={r.purchaseOrder ? `/purchase-orders/${r.purchaseOrder.id}/edit` : null} mono>
                {r.purchaseOrder?.number}
              </EntityLink>
            ),
          },
          {
            key: 'createdAt',
            label: t('common.date'),
            className: 'w-24 whitespace-nowrap',
            render: (r) => fmtDate(r.createdAt),
          },
          {
            key: 'totalAmount',
            label: t('purchaseReturns.returnTotal'),
            className: 'w-32 text-end',
            render: (r) => (
              <span className="tabular-nums font-medium">
                {fmtMoney(r.totalAmount, r.purchaseOrder?.currency)}
              </span>
            ),
          },
          {
            key: 'refundMethod',
            label: t('purchaseReturns.refundMethod'),
            className: 'w-32',
            render: (r) => t(`purchaseReturns.${r.refundMethod}`),
          },
          { key: 'status', label: t('common.status'), className: 'w-28', render: (r) => <StatusChip status={r.status} /> },
        ]}
      />

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle>
              {t('purchaseReturns.details')} — {detail?.number}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid gap-2 rounded-md bg-muted p-3 text-sm sm:grid-cols-3">
                <div>
                  {t('common.supplier')}: <b>{detail.supplier?.name}</b>
                </div>
                <div>
                  {t('inventory.warehouses')}: <b>{detail.warehouse?.name ?? '—'}</b>
                </div>
                <div>
                  {t('purchaseReturns.returnTotal')}:{' '}
                  <b className="tabular-nums">{fmtMoney(detail.totalAmount, detail.purchaseOrder?.currency)}</b>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common.product')}</TableHead>
                    <TableHead className="w-20 text-end">{t('common.quantity')}</TableHead>
                    <TableHead className="w-28 text-end">{t('common.unitCost')}</TableHead>
                    <TableHead className="min-w-40">{t('inventory.serials')}</TableHead>
                    <TableHead className="w-28 text-end">{t('common.lineTotal')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(detail.items ?? []).map((i: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell>
                        <div className="font-medium">{i.product?.name ?? '—'}</div>
                        <div className="font-mono text-xs text-muted-foreground">{i.product?.sku}</div>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{i.quantity}</TableCell>
                      <TableCell className="text-end tabular-nums">
                        {fmtMoney(i.unitCost, detail.purchaseOrder?.currency)}
                      </TableCell>
                      <TableCell className="whitespace-normal font-mono text-xs" dir="ltr">
                        {i.serialNumbers?.length ? i.serialNumbers.join(', ') : '—'}
                      </TableCell>
                      <TableCell className="text-end tabular-nums font-medium">
                        {fmtMoney(i.lineTotal ?? i.quantity * i.unitCost, detail.purchaseOrder?.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {detail.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{detail.notes}</p>}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('common.status')}>
                  <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {['PENDING', 'SENT', 'CREDITED', 'REPLACED', 'CLOSED'].map((s) => (
                      <option key={s} value={s}>
                        {t(`status.${s}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('purchaseReturns.creditNoteRef')}>
                  <Input
                    value={form.creditNoteRef ?? ''}
                    onChange={(e) => setForm({ ...form, creditNoteRef: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={saveStatus}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
