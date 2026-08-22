'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Store, Eye, EyeOff, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

/** Ambiguity-free alphabet: this gets read aloud or typed by hand. */
function suggestPassword() {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(16));
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('');
}

/**
 * Provision a store and its first admin in one step.
 *
 * The two halves are one form on purpose: a store with no way in is not a
 * finished thing, and leaving the admin account as a second step is how you end
 * up with orphaned tenants nobody can sign in to.
 */
export default function CreateTenantDialog({ open, onOpenChange, onCreated }: Props) {
  const t = useTranslations();
  const [name, setName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [invite, setInvite] = useState(false);
  const [maxUsers, setMaxUsers] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setName('');
    setAdminName('');
    setAdminEmail('');
    setAdminPassword('');
    setInvite(false);
    setMaxUsers('');
    setShowPassword(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite && adminPassword.length < 8) return toast.error(t('auth.passwordTooShort'));
    setLoading(true);
    try {
      const { data } = await api.post('/superadmin/tenants', {
        name: name.trim(),
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim(),
        ...(invite ? { invite: true } : { adminPassword }),
        ...(maxUsers ? { maxUsers: Number(maxUsers) } : {}),
      });
      toast.success(
        data.invited
          ? t('superadmin.storeCreatedInvited', { name: data.tenant.name })
          : t('superadmin.storeCreated', { name: data.tenant.name }),
      );
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" />
            {t('superadmin.newStore')}
          </DialogTitle>
          <DialogDescription>{t('superadmin.newStoreDescription')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="store-name">{t('superadmin.storeName')}</Label>
            <Input
              id="store-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('superadmin.storeNamePlaceholder')}
              required
              autoFocus
            />
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('superadmin.tenantAdminAccount')}
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="admin-name">{t('superadmin.adminName')}</Label>
              <Input id="admin-name" value={adminName} onChange={(e) => setAdminName(e.target.value)} required />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-email">{t('superadmin.adminEmail')}</Label>
              <Input
                id="admin-email"
                type="email"
                dir="ltr"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                required
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={invite}
                onChange={(e) => setInvite(e.target.checked)}
              />
              {t('superadmin.sendInviteInstead')}
            </label>

            {!invite && (
              <div className="space-y-1.5">
                <Label htmlFor="admin-password">{t('superadmin.initialPassword')}</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="admin-password"
                      type={showPassword ? 'text' : 'password'}
                      dir="ltr"
                      className="pe-10"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title={t('superadmin.generatePassword')}
                    onClick={() => {
                      setAdminPassword(suggestPassword());
                      setShowPassword(true);
                    }}
                  >
                    <Wand2 className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('superadmin.passwordHandoverNote')}</p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="max-users">{t('superadmin.maxUsers')}</Label>
            <Input
              id="max-users"
              type="number"
              min={1}
              value={maxUsers}
              onChange={(e) => setMaxUsers(e.target.value)}
              placeholder={t('superadmin.unlimited')}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? t('common.saving') : t('superadmin.createStore')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
