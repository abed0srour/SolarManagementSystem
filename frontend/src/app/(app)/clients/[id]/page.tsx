'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  BadgeDollarSign, CreditCard, FileSpreadsheet, Mail, MapPin, Phone, Pencil, Plus, ShoppingCart, StickyNote, Wallet,
} from 'lucide-react';
import { api, errMsg, fmtDate, fmtMoney } from '../../../../lib/api';
import PageHeader from '../../../../components/page-header';
import StatusChip from '../../../../components/status-chip';
import EntityLink, { linkTo } from '../../../../components/entity-link';
import ClientStatementDialog from '../../../../components/client-statement-dialog';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/ui/table';

/**
 * Everything about one client on a page of its own.
 *
 * The same facts used to live only in a popup, which meant a client reference in
 * a table could be inspected but never linked to, shared, or opened in a second
 * tab. `GET /clients/:id` already returned the documents, so this is mostly a
 * matter of giving them a URL.
 */
export default function ClientDetailPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [client, setClient] = useState<any>(null);
  const [missing, setMissing] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);

  const load = useCallback(() => {
    api
      .get(`/clients/${params.id}`)
      .then((r) => setClient(r.data))
      .catch((e) => {
        setMissing(true);
        toast.error(errMsg(e));
      });
  }, [params.id]);
  useEffect(load, [load]);

  if (missing) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('common.noRecords')}</p>
        <Button variant="outline" onClick={() => router.push('/clients')}>{t('nav.clients')}</Button>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const Row = ({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) =>
    value ? (
      <div className="flex items-start gap-2 text-sm">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">{label}:</span>
        <span className="min-w-0 break-words font-medium">{value}</span>
      </div>
    ) : null;

  const orders: any[] = client.salesOrders ?? [];
  const invoices: any[] = client.invoices ?? [];
  const payments: any[] = client.payments ?? [];
  const quotations: any[] = client.quotations ?? [];
  const claims: any[] = client.warrantyClaims ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          icon={Wallet}
          title={client.name}
          subtitle={[client.phone, client.email].filter(Boolean).join(' · ') || undefined}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setStatementOpen(true)}>
            <FileSpreadsheet /> {t('clients.generateStatement')}
          </Button>
          <Button variant="outline" onClick={() => router.push(`/clients/${client.id}/orders`)}>
            <ShoppingCart /> {t('nav.salesOrders')}
          </Button>
          <Button onClick={() => router.push(`/clients/${client.id}/new-order`)}>
            <Plus /> {t('clients.newOrder')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{t(`clients.${client.type}`)}</Badge>
        <Badge variant="outline">{t(`clients.${client.tier}`)}</Badge>
        {client.deletedAt && <Badge variant="destructive">{t('common.archive')}</Badge>}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">{t('clients.lifetimeValue')}</div>
          <div className="text-2xl font-bold tabular-nums">{fmtMoney(client.lifetimeValue ?? 0)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">{t('clients.outstanding')}</div>
          <div className={`text-2xl font-bold tabular-nums ${Number(client.outstandingBalance) > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
            {fmtMoney(client.outstandingBalance ?? 0)}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">{t('nav.salesOrders')}</div>
          <div className="text-2xl font-bold tabular-nums">{orders.length}</div>
        </CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('clients.details')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Row icon={Phone} label={t('common.phone')} value={client.phone} />
            <Row icon={Mail} label={t('common.email')} value={client.email} />
            <Row icon={CreditCard} label={t('clients.creditLimit')} value={fmtMoney(client.creditLimit ?? 0)} />
            <Row icon={BadgeDollarSign} label={t('clients.taxNumber')} value={client.taxNumber} />
            {(client.addresses ?? []).map((a: any) => (
              <Row key={a.id} icon={MapPin} label={t('common.address')} value={[a.line1, a.city, a.country].filter(Boolean).join(', ')} />
            ))}
            <Row icon={StickyNote} label={t('common.notes')} value={client.notes} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <Tabs defaultValue="orders">
              <TabsList>
                <TabsTrigger value="orders">{t('nav.salesOrders')} ({orders.length})</TabsTrigger>
                <TabsTrigger value="invoices">{t('nav.invoices')} ({invoices.length})</TabsTrigger>
                <TabsTrigger value="payments">{t('nav.payments')} ({payments.length})</TabsTrigger>
                <TabsTrigger value="quotations">{t('nav.quotations')} ({quotations.length})</TabsTrigger>
                <TabsTrigger value="warranty">{t('nav.warranty')} ({claims.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="orders">
                <MiniTable
                  cols={[t('quotations.number'), t('common.date'), t('common.status'), t('common.total')]}
                  rows={orders}
                  empty={t('common.noRecords')}
                  render={(o) => [
                    <EntityLink key="n" href={linkTo.salesOrder(o.id)} mono>{o.number}</EntityLink>,
                    fmtDate(o.orderDate ?? o.createdAt),
                    <StatusChip key="s" status={o.status} />,
                    <span key="t" className="tabular-nums">{fmtMoney(o.total)}</span>,
                  ]}
                />
              </TabsContent>

              <TabsContent value="invoices">
                <MiniTable
                  cols={[t('quotations.number'), t('common.date'), t('common.status'), t('common.total')]}
                  rows={invoices}
                  empty={t('common.noRecords')}
                  render={(i) => [
                    <EntityLink key="n" href={linkTo.invoice(i.id)} mono>{i.number}</EntityLink>,
                    fmtDate(i.issueDate),
                    <StatusChip key="s" status={i.status} />,
                    <span key="t" className="tabular-nums">{fmtMoney(i.total)}</span>,
                  ]}
                />
              </TabsContent>

              <TabsContent value="payments">
                <MiniTable
                  cols={[t('quotations.number'), t('common.date'), t('common.method'), t('common.amount')]}
                  rows={payments}
                  empty={t('common.noRecords')}
                  render={(p) => [
                    <span key="n" className="font-mono text-xs">{p.number}</span>,
                    fmtDate(p.paymentDate),
                    t(`payments.${p.method}`),
                    <span key="a" className="tabular-nums text-green-600 dark:text-green-400">{fmtMoney(p.amount)}</span>,
                  ]}
                />
              </TabsContent>

              <TabsContent value="quotations">
                <MiniTable
                  cols={[t('quotations.number'), t('common.date'), t('common.status'), t('common.total')]}
                  rows={quotations}
                  empty={t('common.noRecords')}
                  render={(q) => [
                    <span key="n" className="font-mono text-xs">{q.number}</span>,
                    fmtDate(q.createdAt),
                    <StatusChip key="s" status={q.status} />,
                    <span key="t" className="tabular-nums">{fmtMoney(q.total)}</span>,
                  ]}
                />
              </TabsContent>

              <TabsContent value="warranty">
                <MiniTable
                  cols={[t('quotations.number'), t('common.date'), t('common.status'), '']}
                  rows={claims}
                  empty={t('common.noRecords')}
                  render={(c) => [
                    <span key="n" className="font-mono text-xs">{c.number}</span>,
                    fmtDate(c.openedAt),
                    <StatusChip key="s" status={c.status} />,
                    '',
                  ]}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <ClientStatementDialog
        open={statementOpen}
        onOpenChange={setStatementOpen}
        client={client}
      />
    </div>
  );
}

/** Compact table for the document lists on this page. */
function MiniTable({
  cols, rows, render, empty,
}: {
  cols: string[]; rows: any[]; render: (row: any) => React.ReactNode[]; empty: string;
}) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>{cols.map((c, i) => <TableHead key={i} className={i === cols.length - 1 ? 'text-end' : ''}>{c}</TableHead>)}</TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={r.id ?? i}>
            {render(r).map((cell, j) => (
              <TableCell key={j} className={j === cols.length - 1 ? 'text-end' : ''}>{cell}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
