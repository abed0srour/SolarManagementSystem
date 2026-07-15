'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api, errMsg, fmtDateTime } from '../../../lib/api';
import Field from '../../../components/form-field';
import DataTable from '../../../components/data-table';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

export default function SettingsPage() {
  const t = useTranslations();
  const [company, setCompany] = useState<any>({});
  const [finance, setFinance] = useState<any>({});
  const [sequences, setSequences] = useState<any[]>([]);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });

  const load = () => {
    api.get('/settings').then((r) => {
      setCompany(r.data.company ?? {});
      setFinance(r.data.finance ?? {});
    });
    api.get('/settings/sequences').then((r) => setSequences(r.data));
  };
  useEffect(load, []);

  const saveSetting = async (key: string, value: any) => {
    try {
      await api.put(`/settings/${key}`, value);
      toast.success(t('common.saved'));
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const saveSequence = async (seq: any) => {
    try {
      await api.patch(`/settings/sequences/${seq.id}`, {
        prefix: seq.prefix,
        nextNumber: Number(seq.nextNumber),
        padding: Number(seq.padding),
      });
      toast.success(t('common.saved'));
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const changePassword = async () => {
    try {
      await api.post('/auth/change-password', pw);
      toast.success(t('common.saved'));
      setPw({ currentPassword: '', newPassword: '' });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
      <Tabs defaultValue="company">
        <TabsList className="flex-wrap">
          <TabsTrigger value="company">{t('settings.company')}</TabsTrigger>
          <TabsTrigger value="finance">{t('settings.finance')}</TabsTrigger>
          <TabsTrigger value="sequences">{t('settings.sequences')}</TabsTrigger>
          <TabsTrigger value="security">{t('settings.security')}</TabsTrigger>
        </TabsList>

        <TabsContent value="company">
          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-2">
              <Field label={t('settings.companyName')}>
                <Input value={company.name ?? ''} onChange={(e) => setCompany({ ...company, name: e.target.value })} />
              </Field>
              <Field label={t('common.phone')}>
                <Input value={company.phone ?? ''} onChange={(e) => setCompany({ ...company, phone: e.target.value })} />
              </Field>
              <Field label={t('common.email')}>
                <Input value={company.email ?? ''} onChange={(e) => setCompany({ ...company, email: e.target.value })} />
              </Field>
              <Field label={t('clients.taxNumber')}>
                <Input value={company.taxNumber ?? ''} onChange={(e) => setCompany({ ...company, taxNumber: e.target.value })} />
              </Field>
              <Field label={t('common.address')} className="md:col-span-2">
                <Input value={company.address ?? ''} onChange={(e) => setCompany({ ...company, address: e.target.value })} />
              </Field>
              <div>
                <Button onClick={() => saveSetting('company', company)}>{t('common.save')}</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="finance">
          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-2">
              <Field label={t('settings.defaultTaxRate')}>
                <Input type="number" min={0} value={finance.defaultTaxRatePct ?? 0} onChange={(e) => setFinance({ ...finance, defaultTaxRatePct: Number(e.target.value) })} />
              </Field>
              <Field label={t('settings.baseCurrency')}>
                <Input value={finance.baseCurrency ?? 'USD'} onChange={(e) => setFinance({ ...finance, baseCurrency: e.target.value })} />
              </Field>
              <Field label={t('settings.secondaryCurrency')}>
                <Input value={finance.secondaryCurrency ?? ''} onChange={(e) => setFinance({ ...finance, secondaryCurrency: e.target.value })} />
              </Field>
              <Field label={t('settings.exchangeRate')}>
                <Input type="number" min={0} value={finance.exchangeRate ?? 1} onChange={(e) => setFinance({ ...finance, exchangeRate: Number(e.target.value) })} />
              </Field>
              <div>
                <Button onClick={() => saveSetting('finance', finance)}>{t('common.save')}</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sequences">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('audit.entity')}</TableHead>
                    <TableHead>{t('settings.prefix')}</TableHead>
                    <TableHead>{t('settings.nextNumber')}</TableHead>
                    <TableHead>{t('settings.padding')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sequences.map((s, i) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.entity}</TableCell>
                      <TableCell>
                        <Input className="w-24" value={s.prefix} onChange={(e) => setSequences(sequences.map((x, j) => (j === i ? { ...x, prefix: e.target.value } : x)))} />
                      </TableCell>
                      <TableCell>
                        <Input className="w-24" type="number" min={1} value={s.nextNumber} onChange={(e) => setSequences(sequences.map((x, j) => (j === i ? { ...x, nextNumber: e.target.value } : x)))} />
                      </TableCell>
                      <TableCell>
                        <Input className="w-20" type="number" min={1} max={10} value={s.padding} onChange={(e) => setSequences(sequences.map((x, j) => (j === i ? { ...x, padding: e.target.value } : x)))} />
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => saveSequence(s)}>{t('common.save')}</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{t('auth.changePassword')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Field label={t('auth.currentPassword')}>
                  <Input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
                </Field>
                <Field label={t('auth.newPassword')}>
                  <Input type="password" minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
                </Field>
                <Button onClick={changePassword} disabled={!pw.currentPassword || pw.newPassword.length < 8}>
                  {t('common.save')}
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{t('settings.loginHistory')}</CardTitle></CardHeader>
              <CardContent className="p-0">
                <DataTable
                  endpoint="/auth/login-history"
                  searchable={false}
                  columns={[
                    { key: 'createdAt', label: t('audit.when'), render: (r) => <span className="text-xs">{fmtDateTime(r.createdAt)}</span> },
                    { key: 'email', label: t('common.email') },
                    {
                      key: 'success', label: t('common.status'),
                      render: (r) => <Badge variant={r.success ? 'success' : 'destructive'}>{r.success ? t('settings.success') : t('settings.failed')}</Badge>,
                    },
                    { key: 'ip', label: 'IP', render: (r) => <span className="font-mono text-xs">{r.ip ?? '—'}</span> },
                  ]}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
