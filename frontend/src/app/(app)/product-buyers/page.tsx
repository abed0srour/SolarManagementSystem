'use client';
import { Users as PageIcon, ExternalLink, PackageSearch } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import PageHeader from '../../../components/page-header';
import DataTable from '../../../components/data-table';
import StatusChip from '../../../components/status-chip';
import EntityLink, { linkTo } from '../../../components/entity-link';
import { ProductPicker } from '../../../components/entity-picker';
import { fmtDate, fmtMoney } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';

/**
 * "Who bought this product?" — the question you ask when a batch turns out to
 * be faulty and you need to reach every customer holding one.
 *
 * One row per sales-order line rather than per customer, because the same
 * client buying the same product twice is two separate deliveries with two
 * separate sets of serial numbers, and a recall has to reach both.
 */
export default function ProductBuyersPage() {
  const t = useTranslations();
  const router = useRouter();
  const [product, setProduct] = useState<any>(null);

  return (
    <div className="space-y-4">
      <PageHeader icon={PageIcon} title={t('productBuyers.title')} subtitle={t('subtitles.productBuyers')} />

      <Card>
        <CardContent className="p-4">
          <div className="max-w-xl">
            <ProductPicker value={product} onChange={setProduct} placeholder={t('productBuyers.pickProduct')} />
          </div>
        </CardContent>
      </Card>

      {!product ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          <PackageSearch className="h-8 w-8 opacity-50" />
          <p className="text-sm">{t('productBuyers.choose')}</p>
        </div>
      ) : (
        <DataTable
          // Keyed by product so switching products resets paging and cache.
          key={product.id}
          endpoint={`/products/${product.id}/buyers`}
          searchable
          columns={[
            {
              key: 'client',
              label: t('common.client'),
              mobile: 'primary',
              render: (r) => (
                <div>
                  <EntityLink href={linkTo.client(r.client?.id)}>{r.client?.name}</EntityLink>
                  {r.client?.phone && (
                    <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                      {r.client.phone}
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: 'order',
              label: t('nav.salesOrders'),
              className: 'w-28',
              render: (r) => <span className="font-mono text-xs">{r.order?.number}</span>,
            },
            {
              key: 'orderDate',
              label: t('productBuyers.purchased'),
              className: 'w-28 whitespace-nowrap',
              render: (r) => fmtDate(r.order?.orderDate),
            },
            {
              key: 'quantity',
              label: t('common.quantity'),
              className: 'w-20 text-end',
              render: (r) => <span className="tabular-nums">{r.quantity}</span>,
            },
            {
              key: 'lineTotal',
              label: t('common.lineTotal'),
              className: 'w-28 text-end',
              render: (r) => <span className="tabular-nums font-medium">{fmtMoney(r.lineTotal)}</span>,
            },
            {
              key: 'serialNumbers',
              label: t('inventory.serials'),
              className: 'min-w-40',
              render: (r) =>
                r.serialNumbers?.length ? (
                  <span className="whitespace-normal font-mono text-xs" dir="ltr">
                    {r.serialNumbers.join(', ')}
                  </span>
                ) : (
                  '—'
                ),
            },
            {
              key: 'status',
              label: t('common.status'),
              className: 'w-32',
              render: (r) => <StatusChip status={r.order?.status} />,
            },
            {
              key: 'actions',
              label: '',
              className: 'w-12',
              render: (r) => (
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title={t('productBuyers.openOrder')}
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/sales-orders/${r.order.id}`);
                    }}
                  >
                    <ExternalLink />
                  </Button>
                </div>
              ),
            },
          ]}
          onRowClick={(r) => router.push(`/sales-orders/${r.order.id}`)}
        />
      )}
    </div>
  );
}
