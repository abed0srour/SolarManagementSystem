'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, ArrowRightCircle, Archive, RotateCcw, FileDown, FileText as PageIcon } from 'lucide-react';
import { api, errMsg, fmtMoney, fmtDate, downloadFile } from '../../../lib/api';
import PageHeader from '../../../components/page-header';
import DataTable from '../../../components/data-table';
import ConfirmDialog from '../../../components/confirm-dialog';
import StatusChip from '../../../components/status-chip';
import Field from '../../../components/form-field';
import EntityLink, { linkTo } from '../../../components/entity-link';
import { WarehousePicker } from '../../../components/entity-picker';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import QuotationForm from '../../../components/quotation-form';

export default function QuotationsPage() {
  const t = useTranslations();
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [convertFor, setConvertFor] = useState<any>(null);
  const [convertWh, setConvertWh] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [archived, setArchived] = useState(false);

  const openCreate = () => {
    router.push('/quotations/new');
  };

  const openEdit = (row: any) => {
    router.push(`/quotations/${row.id}/edit`);
  };

  /** Archiving is reversible: restoring is the exact inverse of the soft delete. */
  const restore = async (row: any) => {
    try {
      await api.post(`/quotations/${row.id}/restore`);
      toast.success(t('common.restored'));
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const convert = async () => {
    try {
      await api.post(`/quotations/${convertFor.id}/convert`, { warehouseId: convertWh?.id });
      toast.success(t('quotations.converted'));
      setConvertFor(null);
      setConvertWh(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('quotations.title')} subtitle={t('subtitles.quotations')} />
      <DataTable
        endpoint="/quotations"
        refreshKey={refreshKey}
        archived={archived}
        onArchivedChange={setArchived}
        extraParams={statusFilter ? { status: statusFilter } : undefined}
        // Archived rows are read-only — restore before editing.
        onRowClick={archived ? undefined : openEdit}
        filters={
          <Select className="w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {['DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </Select>
        }
        toolbar={
          <Button onClick={openCreate}>
            <Plus /> {t('quotations.newQuotation')}
          </Button>
        }
        columns={[
          { key: 'number', label: t('quotations.number'), mobile: 'primary', render: (r) => <span className="font-mono text-sm font-semibold">{r.number}</span> },
          {
            key: 'client', label: t('common.client'),
            render: (r) => <EntityLink href={linkTo.client(r.clientId)}>{r.client?.name}</EntityLink>,
          },
          { key: 'createdAt', label: t('common.date'), render: (r) => fmtDate(r.createdAt) },
          { key: 'validUntil', label: t('quotations.validUntil'), render: (r) => fmtDate(r.validUntil) },
          { key: 'total', label: t('common.total'), className: 'text-end', render: (r) => <span className="tabular-nums font-medium">{fmtMoney(r.total)}</span> },
          { key: 'status', label: t('common.status'), render: (r) => <StatusChip status={r.status} /> },
          {
            key: 'actions', label: '',
            render: (r) => (
              <div className="flex justify-end gap-1">
                {archived ? (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 dark:text-emerald-400" title={t('common.restore')} onClick={(e) => { e.stopPropagation(); restore(r); }}>
                    <RotateCcw />
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-primary"
                      title={t('common.downloadPdf')}
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadFile(`/quotations/${r.id}/pdf`, `quotation-${r.number}.pdf`).catch((err) =>
                          toast.error(errMsg(err)),
                        );
                      }}
                    >
                      <FileDown />
                    </Button>
                    {['DRAFT', 'SENT', 'ACCEPTED'].includes(r.status) && r.salesOrders?.length === 0 && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" title={t('quotations.convert')} onClick={(e) => { e.stopPropagation(); setConvertFor(r); }}>
                        <ArrowRightCircle />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 dark:text-red-400" title={t('common.archive')} onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}>
                      <Archive />
                    </Button>
                  </>
                )}
              </div>
            ),
          },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle>{editing ? `${editing.number}` : t('quotations.newQuotation')}</DialogTitle>
          </DialogHeader>
          <QuotationForm
            quotationId={editing?.id}
            isModal
            onSaved={() => {
              setOpen(false);
              setRefreshKey((k) => k + 1);
            }}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Convert dialog */}
      <Dialog open={!!convertFor} onOpenChange={(v) => !v && setConvertFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('quotations.convert')} — {convertFor?.number}</DialogTitle></DialogHeader>
          <Field label={t('common.warehouse')}>
            <WarehousePicker value={convertWh} onChange={setConvertWh} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertFor(null)}>{t('common.cancel')}</Button>
            <Button onClick={convert} disabled={!convertWh}>{t('common.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        requireText={t('common.deleteWord')}
        usagePath={deleteTarget ? `/quotations/${deleteTarget.id}/usage` : undefined}
        onConfirm={async () => {
          try {
            const { data } = await api.delete(`/quotations/${deleteTarget.id}`);
            // A quotation nobody accepted is deleted outright; an accepted one is
            // archived. Say which actually happened.
            toast.success(data?.mode === 'PURGED' ? t('common.purgedToast') : t('common.archivedToast'));
            setRefreshKey((k) => k + 1);
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
