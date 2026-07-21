'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Phone, Mail, MapPin, CreditCard, Wallet, StickyNote, BadgeDollarSign } from 'lucide-react';
import { api, fmtMoney } from '../lib/api';
import { Badge } from './ui/badge';
import { Skeleton } from './ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

interface Props {
  clientId: string | null;
  onOpenChange: (open: boolean) => void;
}

/** Read-only popup with everything about a client. Open by setting clientId. */
export default function ClientInfoDialog({ clientId, onOpenChange }: Props) {
  const t = useTranslations();
  const [client, setClient] = useState<any>(null);

  useEffect(() => {
    if (!clientId) {
      setClient(null);
      return;
    }
    api.get(`/clients/${clientId}/brief`).then((r) => setClient(r.data)).catch(() => onOpenChange(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const Row = ({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) =>
    value ? (
      <div className="flex items-start gap-2 text-sm">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">{label}:</span>
        <span className="min-w-0 break-words font-medium">{value}</span>
      </div>
    ) : null;

  return (
    <Dialog open={!!clientId} onOpenChange={onOpenChange}>
      <DialogContent>
        {!client ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {client.name}
                <Badge variant="outline">{t(`clients.${client.type}`)}</Badge>
                <Badge variant="outline">{t(`clients.${client.tier}`)}</Badge>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Row icon={Phone} label={t('common.phone')} value={client.phone} />
              <Row icon={Mail} label={t('common.email')} value={client.email} />
              <Row icon={CreditCard} label={t('clients.creditLimit')} value={fmtMoney(client.creditLimit)} />
              <Row
                icon={BadgeDollarSign}
                label={t('clients.outstanding')}
                value={
                  <span className={Number(client.outstandingBalance) > 0 ? 'text-amber-600 dark:text-amber-400' : ''}>
                    {fmtMoney(client.outstandingBalance ?? 0)}
                  </span>
                }
              />
              <Row icon={Wallet} label={t('clients.storeCredit')} value={fmtMoney(client.storeCredit)} />
              <Row icon={StickyNote} label={t('common.notes')} value={client.notes} />

              {/* Addresses — always visible as its own section */}
              <div className="mt-3 border-t pt-3">
                <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
                  <MapPin className="h-4 w-4 text-muted-foreground" /> {t('clients.addresses')}
                </div>
                {(client.addresses ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">—</p>
                ) : (
                  <div className="space-y-1.5">
                    {client.addresses.map((a: any) => (
                      <div key={a.id} className="rounded-md bg-muted px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{a.label || t('common.address')}</span>
                          {a.isBilling && <Badge variant="outline">{t('clients.billing')}</Badge>}
                          {a.isInstallation && <Badge variant="outline">{t('clients.installation')}</Badge>}
                        </div>
                        <div className="text-muted-foreground">{[a.line1, a.city].filter(Boolean).join(', ') || '—'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
