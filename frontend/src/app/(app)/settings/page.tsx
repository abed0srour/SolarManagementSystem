'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Building2, Coins, Hash, ShieldCheck, KeyRound, Mail, MailCheck, Upload, History, Settings as SettingsIcon,
  DatabaseBackup, Download, RotateCcw, PlayCircle, CheckCircle2, XCircle, HardDrive, FileSpreadsheet, UsersRound, Trash2,
} from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { api, errMsg, fmtDateTime, downloadFile } from '../../../lib/api';
import { getUser, setUser } from '../../../lib/auth';
import { invalidateCache } from '../../../lib/cache';
import Field from '../../../components/form-field';
import DataTable from '../../../components/data-table';
import ConfirmDialog from '../../../components/confirm-dialog';
import { CSV_BACKUP_ENABLED_KEY, csvBackupEnabled, csvFilename } from '../../../components/daily-csv-backup';
import { PasswordInput } from '../../../components/ui/password-input';
import UsersManager from '../../../components/users-manager';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { FormattedNumberInput } from '../../../components/ui/formatted-number-input';
import { Select } from '../../../components/ui/select';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

export default function SettingsPage() {
  const t = useTranslations();
  const [company, setCompany] = useState<any>({});
  const [finance, setFinance] = useState<any>({});
  const [sequences, setSequences] = useState<any[]>([]);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '', busy: false });
  const [em, setEm] = useState({ currentPassword: '', newEmail: '', code: '', codeSent: false, busy: false });
  const [backup, setBackup] = useState<any>(null);
  const [schedule, setSchedule] = useState<any>({ enabled: true, dayOfWeek: 0, hour: 3, minute: 0 });
  const [backupBusy, setBackupBusy] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvDaily, setCsvDaily] = useState(true);
  const [restoreLocalOpen, setRestoreLocalOpen] = useState(false);
  const [restoreUploadOpen, setRestoreUploadOpen] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  // Presentation only — /users is independently restricted server-side.
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  useEffect(() => setIsSuperAdmin(getUser()?.role === 'SUPER_ADMIN'), []);

  const load = () => {
    api.get('/settings').then((r) => {
      setCompany(r.data.company ?? {});
      setFinance(r.data.finance ?? {});
    });
    api.get('/settings/sequences').then((r) => setSequences(r.data));
  };
  useEffect(load, []);

  const loadBackup = () => {
    api.get('/backup/status').then((r) => {
      setBackup(r.data);
      setSchedule(r.data.schedule);
    });
  };
  useEffect(loadBackup, []);

  // localStorage is only readable after mount, so the toggle syncs here.
  useEffect(() => setCsvDaily(csvBackupEnabled()), []);

  const runBackupNow = async () => {
    setBackupBusy(true);
    try {
      await api.post('/backup/run');
      toast.success(t('settings.backupDone'));
      loadBackup();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBackupBusy(false);
    }
  };

  const saveSchedule = async () => {
    try {
      await api.put('/backup/schedule', schedule);
      toast.success(t('common.saved'));
      loadBackup();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const doDownload = async () => {
    try {
      await downloadFile('/backup/download', `solar-store-backup-${new Date().toISOString().slice(0, 10)}.json.gz`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const doCsvExport = async () => {
    setCsvBusy(true);
    try {
      await downloadFile('/backup/csv', csvFilename());
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setCsvBusy(false);
    }
  };

  const doRestoreLocal = async () => {
    setBackupBusy(true);
    try {
      const { data } = await api.post('/backup/restore/local');
      toast.success(t('settings.restoreDone', { rows: data.rowCount }));
      loadBackup();
    } catch (e) {
      toast.error(errMsg(e));
      throw e;
    } finally {
      setBackupBusy(false);
    }
  };

  const doRestoreUpload = async () => {
    if (!restoreFile) return;
    setBackupBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', restoreFile);
      const { data } = await api.post('/backup/restore/upload', fd);
      toast.success(t('settings.restoreDone', { rows: data.rowCount }));
      setRestoreFile(null);
      loadBackup();
    } catch (e) {
      toast.error(errMsg(e));
      throw e;
    } finally {
      setBackupBusy(false);
    }
  };

  const saveSetting = async (key: string, value: any) => {
    try {
      await api.put(`/settings/${key}`, value);
      // Branding and company details are read from cache on every page load.
      invalidateCache('settings');
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

  const pwMismatch = pw.confirmPassword.length > 0 && pw.newPassword !== pw.confirmPassword;
  const canChangePassword =
    !!pw.currentPassword && pw.newPassword.length >= 8 && pw.newPassword === pw.confirmPassword;

  // Changed directly against the current password — no emailed code, so this
  // works with no SMTP configured. Changing the email still uses a code, since
  // there the point is proving control of the mailbox.
  const changePassword = async () => {
    setPw((p) => ({ ...p, busy: true }));
    try {
      await api.post('/auth/change-password', {
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
      });
      toast.success(t('common.saved'));
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '', busy: false });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setPw((p) => ({ ...p, busy: false }));
    }
  };

  const requestEmailChange = async () => {
    setEm((p) => ({ ...p, busy: true }));
    try {
      await api.post('/auth/request-email-change', { currentPassword: em.currentPassword, newEmail: em.newEmail });
      setEm((p) => ({ ...p, codeSent: true, code: '' }));
      toast.success(t('auth.codeSent'));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setEm((p) => ({ ...p, busy: false }));
    }
  };

  const confirmEmailChange = async () => {
    setEm((p) => ({ ...p, busy: true }));
    try {
      const { data } = await api.post('/auth/confirm-email-change', { code: em.code });
      if (data.user) setUser(data.user);
      toast.success(t('common.saved'));
      setEm({ currentPassword: '', newEmail: '', code: '', codeSent: false, busy: false });
    } catch (e) {
      toast.error(errMsg(e));
      setEm((p) => ({ ...p, busy: false }));
    }
  };

  const CodeBanner = () => (
    <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
      <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span>{t('auth.codeHint')}</span>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader icon={SettingsIcon} title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <Tabs defaultValue="company">
        <TabsList className="w-full sm:w-auto flex flex-wrap h-auto p-1 gap-1">
          <TabsTrigger value="company"><Building2 className="me-1.5 h-4 w-4" />{t('settings.company')}</TabsTrigger>
          <TabsTrigger value="finance"><Coins className="me-1.5 h-4 w-4" />{t('settings.finance')}</TabsTrigger>
          <TabsTrigger value="sequences"><Hash className="me-1.5 h-4 w-4" />{t('settings.sequences')}</TabsTrigger>
          <TabsTrigger value="security"><ShieldCheck className="me-1.5 h-4 w-4" />{t('settings.security')}</TabsTrigger>
          <TabsTrigger value="backup"><DatabaseBackup className="me-1.5 h-4 w-4" />{t('settings.backup')}</TabsTrigger>
          {isSuperAdmin && (
            <TabsTrigger value="users"><UsersRound className="me-1.5 h-4 w-4" />{t('users.title')}</TabsTrigger>
          )}
        </TabsList>

        {/* ---- Company ---- */}
        <TabsContent value="company">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" />{t('settings.company')}</CardTitle>
              <CardDescription>{t('settings.companyHint')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t('settings.companyName')}>
                  <Input required placeholder="e.g. Solar Store SAL" value={company.name ?? ''} onChange={(e) => setCompany({ ...company, name: e.target.value })} />
                </Field>
                <Field label={t('settings.tagline')}>
                  <Input placeholder="e.g. Clean Energy Solutions" value={company.tagline ?? ''} onChange={(e) => setCompany({ ...company, tagline: e.target.value })} />
                </Field>
                <Field label={t('common.phone')}>
                  <Input required dir="ltr" placeholder="e.g. +961 1 234 567" value={company.phone ?? ''} onChange={(e) => setCompany({ ...company, phone: e.target.value })} />
                </Field>
                <Field label={t('common.email')}>
                  <Input type="email" dir="ltr" placeholder="e.g. info@solarstore.com" value={company.email ?? ''} onChange={(e) => setCompany({ ...company, email: e.target.value })} />
                </Field>
                <Field label={t('common.address')} className="md:col-span-2">
                  <Input required placeholder="e.g. Beirut, Lebanon" value={company.address ?? ''} onChange={(e) => setCompany({ ...company, address: e.target.value })} />
                </Field>
                {/* Printed on POS receipts and invoices when set. */}
                <Field label={t('settings.taxNumber')}>
                  <Input dir="ltr" placeholder="e.g. 1234567-89" value={company.taxNumber ?? ''} onChange={(e) => setCompany({ ...company, taxNumber: e.target.value })} />
                </Field>
              </div>
              <div className="rounded-md border bg-muted/30 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <Upload className="h-4 w-4 text-muted-foreground" /> {t('settings.logo')}
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border bg-background shrink-0">
                    {company.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={company.logoUrl} alt="logo" className="h-full w-full object-contain" />
                    ) : (
                      <Building2 className="h-6 w-6 text-muted-foreground/40" />
                    )}
                  </div>
                  <Input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="max-w-xs"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const fd = new FormData();
                        fd.append('file', file);
                        fd.append('entity', 'Company');
                        fd.append('entityId', 'company');
                        const { data } = await api.post('/uploads', fd);
                        setCompany({ ...company, logoUrl: data.path });
                        toast.success(t('settings.logoUploaded'));
                      } catch (err) {
                        toast.error(errMsg(err));
                      }
                    }}
                  />
                  {company.logoUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        setCompany({ ...company, logoUrl: null });
                        toast.success(t('settings.logoRemoved'));
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>{t('common.remove')}</span>
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex justify-end border-t pt-4">
                <Button onClick={() => saveSetting('company', company)}>{t('common.save')}</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Finance ---- */}
        <TabsContent value="finance">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Coins className="h-4 w-4 text-primary" />{t('settings.finance')}</CardTitle>
              <CardDescription>{t('settings.financeHint')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t('settings.defaultTaxRate')}>
                  <Input type="number" min={0} placeholder="11" value={finance.defaultTaxRatePct ?? ''} onChange={(e) => setFinance({ ...finance, defaultTaxRatePct: e.target.value === '' ? '' : Number(e.target.value) })} />
                </Field>
                <Field label={t('settings.baseCurrency')}>
                  <Input placeholder="USD" value={finance.baseCurrency ?? 'USD'} onChange={(e) => setFinance({ ...finance, baseCurrency: e.target.value })} />
                </Field>
                <Field label={t('settings.secondaryCurrency')}>
                  <Input placeholder="LBP" value={finance.secondaryCurrency ?? ''} onChange={(e) => setFinance({ ...finance, secondaryCurrency: e.target.value })} />
                </Field>
                <Field label={t('settings.exchangeRate')}>
                  <FormattedNumberInput placeholder="89500" value={finance.exchangeRate ?? ''} onChange={(e) => setFinance({ ...finance, exchangeRate: e.target.value === '' ? '' : Number(e.target.value) })} />
                </Field>
              </div>
              <div className="flex justify-end border-t pt-4">
                <Button onClick={() => saveSetting('finance', finance)}>{t('common.save')}</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Numbering sequences ---- */}
        <TabsContent value="sequences">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Hash className="h-4 w-4 text-primary" />{t('settings.sequences')}</CardTitle>
              <CardDescription>{t('settings.sequencesHint')}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="ps-4">{t('audit.entity')}</TableHead>
                    <TableHead>{t('settings.prefix')}</TableHead>
                    <TableHead>{t('settings.nextNumber')}</TableHead>
                    <TableHead>{t('settings.padding')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sequences.map((s, i) => (
                    <TableRow key={s.id}>
                      <TableCell className="ps-4 font-medium">{s.entity}</TableCell>
                      <TableCell>
                        <Input className="w-24 font-mono" value={s.prefix} onChange={(e) => setSequences(sequences.map((x, j) => (j === i ? { ...x, prefix: e.target.value } : x)))} />
                      </TableCell>
                      <TableCell>
                        <Input className="w-24" type="number" min={1} value={s.nextNumber} onChange={(e) => setSequences(sequences.map((x, j) => (j === i ? { ...x, nextNumber: e.target.value } : x)))} />
                      </TableCell>
                      <TableCell>
                        <Input className="w-20" type="number" min={1} max={10} value={s.padding} onChange={(e) => setSequences(sequences.map((x, j) => (j === i ? { ...x, padding: e.target.value } : x)))} />
                      </TableCell>
                      <TableCell className="pe-4 text-end">
                        <Button variant="outline" size="sm" onClick={() => saveSequence(s)}>{t('common.save')}</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Security ---- */}
        <TabsContent value="security">
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Change password */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" />{t('auth.changePassword')}</CardTitle>
                  <CardDescription>{t('auth.changePasswordHint')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label={t('auth.currentPassword')}>
                    <PasswordInput
                      autoComplete="current-password"
                      value={pw.currentPassword}
                      onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
                    />
                  </Field>
                  <Field label={t('auth.newPassword')} hint={t('auth.passwordMinHint')}>
                    <PasswordInput
                      autoComplete="new-password"
                      value={pw.newPassword}
                      onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
                    />
                  </Field>
                  <Field
                    label={t('auth.confirmPassword')}
                    hint={pwMismatch ? <span className="text-destructive">{t('auth.passwordsDoNotMatch')}</span> : undefined}
                  >
                    <PasswordInput
                      autoComplete="new-password"
                      className={pwMismatch ? 'border-destructive' : undefined}
                      value={pw.confirmPassword}
                      onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })}
                    />
                  </Field>
                  <div className="border-t pt-3">
                    <Button onClick={changePassword} disabled={pw.busy || !canChangePassword}>
                      <KeyRound /> {t('auth.changePassword')}
                    </Button>
                    <p className="mt-2 text-xs text-muted-foreground">{t('auth.changePasswordSignsOut')}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Change email */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4 text-primary" />{t('auth.changeEmail')}</CardTitle>
                  <CardDescription>{t('auth.changeEmailHint')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label={t('auth.currentPassword')}>
                    <Input type="password" disabled={em.codeSent} value={em.currentPassword} onChange={(e) => setEm({ ...em, currentPassword: e.target.value })} />
                  </Field>
                  <Field label={t('auth.newEmail')}>
                    <Input type="email" disabled={em.codeSent} value={em.newEmail} onChange={(e) => setEm({ ...em, newEmail: e.target.value })} />
                  </Field>
                  {em.codeSent ? (
                    <>
                      <CodeBanner />
                      <Field label={t('auth.verificationCode')}>
                        <Input
                          inputMode="numeric"
                          maxLength={6}
                          className="text-center font-mono text-lg tracking-[0.5em]"
                          dir="ltr"
                          value={em.code}
                          onChange={(e) => setEm({ ...em, code: e.target.value.replace(/\D/g, '') })}
                        />
                      </Field>
                      <div className="flex gap-2 border-t pt-3">
                        <Button onClick={confirmEmailChange} disabled={em.busy || em.code.length !== 6}>
                          {t('common.confirm')}
                        </Button>
                        <Button variant="outline" onClick={requestEmailChange} disabled={em.busy}>
                          {t('auth.resendCode')}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="border-t pt-3">
                      <Button onClick={requestEmailChange} disabled={em.busy || !em.currentPassword || !em.newEmail.includes('@')}>
                        <Mail /> {t('auth.sendCode')}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Login history */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><History className="h-4 w-4 text-primary" />{t('settings.loginHistory')}</CardTitle>
              </CardHeader>
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

        {/* ---- Backup & restore ---- */}
        {isSuperAdmin && (
          <TabsContent value="users">
            <UsersManager />
          </TabsContent>
        )}

        <TabsContent value="backup">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><HardDrive className="h-4 w-4 text-primary" />{t('settings.backupStatus')}</CardTitle>
                <CardDescription>{t('settings.backupHint')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border bg-muted/30 p-3 text-sm">
                    <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
                      {backup?.lastBackup?.status === 'SUCCESS' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                      {t('settings.lastBackup')}
                    </div>
                    {backup?.lastBackup ? (
                      <>
                        <div className="font-medium">{fmtDateTime(backup.lastBackup.createdAt)}</div>
                        <div className="text-xs text-muted-foreground">
                          {t('settings.backupSummary', { tables: backup.lastBackup.tableCount, rows: backup.lastBackup.rowCount, size: (backup.lastBackup.sizeBytes / 1024).toFixed(1) })}
                        </div>
                      </>
                    ) : (
                      <div className="text-muted-foreground">{t('settings.neverBackedUp')}</div>
                    )}
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3 text-sm">
                    <div className="mb-1 text-muted-foreground">{t('settings.lastRestore')}</div>
                    {backup?.lastRestore ? (
                      <>
                        <div className="font-medium">{fmtDateTime(backup.lastRestore.createdAt)}</div>
                        <div className="text-xs text-muted-foreground">{t('settings.restoreSummary', { tables: backup.lastRestore.tableCount, rows: backup.lastRestore.rowCount })}</div>
                      </>
                    ) : (
                      <div className="text-muted-foreground">{t('settings.neverRestored')}</div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <Button onClick={runBackupNow} disabled={backupBusy}>
                    <PlayCircle /> {t('settings.backupNow')}
                  </Button>
                  <Button variant="outline" onClick={doDownload} disabled={!backup?.hasLocalFile}>
                    <Download /> {t('settings.downloadBackup')}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* CSV copy on this PC — separate from the restorable snapshot above. */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-primary" />{t('backup.csvExport')}</CardTitle>
                <CardDescription>{t('backup.csvHint')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={csvDaily}
                    onChange={(e) => {
                      setCsvDaily(e.target.checked);
                      localStorage.setItem(CSV_BACKUP_ENABLED_KEY, e.target.checked ? '1' : '0');
                    }}
                  />
                  {t('backup.csvDaily')}
                </label>
                <Button variant="outline" onClick={doCsvExport} disabled={csvBusy}>
                  <Download /> {t('backup.csvExport')}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><DatabaseBackup className="h-4 w-4 text-primary" />{t('settings.backupSchedule')}</CardTitle>
                <CardDescription>{t('settings.backupScheduleHint')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={!!schedule.enabled} onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })} />
                  {t('settings.backupEnabled')}
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('settings.backupDay')}>
                    <Select disabled={!schedule.enabled} value={schedule.dayOfWeek} onChange={(e) => setSchedule({ ...schedule, dayOfWeek: Number(e.target.value) })}>
                      {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                        <option key={d} value={d}>{t(`settings.weekday.${d}`)}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('settings.backupTime')}>
                    <Input
                      type="time"
                      disabled={!schedule.enabled}
                      value={`${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`}
                      onChange={(e) => {
                        const [h, m] = e.target.value.split(':').map(Number);
                        setSchedule({ ...schedule, hour: h || 0, minute: m || 0 });
                      }}
                    />
                  </Field>
                </div>
                <div className="flex justify-end border-t pt-4">
                  <Button onClick={saveSchedule}>{t('common.save')}</Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><RotateCcw className="h-4 w-4 text-destructive" />{t('settings.restore')}</CardTitle>
                <CardDescription>{t('settings.restoreHint')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" className="text-destructive" onClick={() => setRestoreLocalOpen(true)} disabled={!backup?.hasLocalFile || backupBusy}>
                    <RotateCcw /> {t('settings.restoreFromLocal')}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                  <Input
                    type="file"
                    accept=".gz"
                    className="max-w-xs"
                    onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
                  />
                  <Button variant="outline" className="text-destructive" onClick={() => setRestoreUploadOpen(true)} disabled={!restoreFile || backupBusy}>
                    <Upload /> {t('settings.restoreFromFile')}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><History className="h-4 w-4 text-primary" />{t('settings.backupHistory')}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="ps-4">{t('audit.when')}</TableHead>
                      <TableHead>{t('settings.backupType')}</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead className="text-end">{t('settings.backupTables')}</TableHead>
                      <TableHead className="text-end">{t('settings.backupRows')}</TableHead>
                      <TableHead className="text-end">{t('settings.backupSize')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(backup?.history ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t('settings.neverBackedUp')}</TableCell>
                      </TableRow>
                    )}
                    {(backup?.history ?? []).map((h: any) => (
                      <TableRow key={h.id} title={h.error ?? undefined}>
                        <TableCell className="ps-4 text-xs">{fmtDateTime(h.createdAt)}</TableCell>
                        <TableCell>{h.type === 'BACKUP' ? t('settings.backupTypeBackup') : t('settings.backupTypeRestore')}</TableCell>
                        <TableCell>
                          <Badge variant={h.status === 'SUCCESS' ? 'success' : 'destructive'}>
                            {h.status === 'SUCCESS' ? t('settings.success') : t('settings.failed')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-end tabular-nums">{h.tableCount ?? '—'}</TableCell>
                        <TableCell className="text-end tabular-nums">{h.rowCount ?? '—'}</TableCell>
                        <TableCell className="text-end tabular-nums">{h.sizeBytes ? `${(h.sizeBytes / 1024).toFixed(1)} KB` : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <ConfirmDialog
            open={restoreLocalOpen}
            onOpenChange={setRestoreLocalOpen}
            title={t('settings.restore')}
            description={t('settings.restoreConfirm')}
            requireText={t('settings.restoreWord')}
            onConfirm={doRestoreLocal}
          />
          <ConfirmDialog
            open={restoreUploadOpen}
            onOpenChange={setRestoreUploadOpen}
            title={t('settings.restore')}
            description={t('settings.restoreConfirm')}
            requireText={t('settings.restoreWord')}
            onConfirm={doRestoreUpload}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
