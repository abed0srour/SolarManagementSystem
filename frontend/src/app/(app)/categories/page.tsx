'use client';
import { FolderTree as PageIcon } from 'lucide-react';
import PageHeader from '../../../components/page-header';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { api, errMsg } from '../../../lib/api';
import { useLocalFirstData } from '../../../lib/use-local-storage-cache';
import ConfirmDialog from '../../../components/confirm-dialog';
import Field from '../../../components/form-field';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent } from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

type DialogState =
  | { kind: 'category'; data?: any }
  | { kind: 'sub'; categoryId: string; data?: any }
  | { kind: 'attr'; subCategoryId: string; data?: any }
  | null;

export default function CategoriesPage() {
  const t = useTranslations();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<DialogState>(null);
  const [form, setForm] = useState<any>({});
  // Both the endpoint to delete and the one to ask about usage, so the dialog
  // can say whether confirming will archive or permanently delete.
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; usagePath: string } | null>(null);

  // Cache-first, rendered straight from the cached value so a warm visit paints
  // with no intermediate state. `refresh` re-fetches from the API and rewrites
  // localStorage; every mutation below calls it.
  const { data: categories, refresh: load } = useLocalFirstData<any[]>('categories', () =>
    api.get('/categories').then((r) => r.data),
  );

  const openDialog = (state: DialogState) => {
    setForm(
      state?.data
        ? { ...state.data, options: Array.isArray(state.data.options) ? state.data.options.join(', ') : '' }
        : { type: 'TEXT', required: false },
    );
    setDialog(state);
  };

  const save = async () => {
    try {
      if (dialog?.kind === 'category') {
        const payload = { name: form.name, description: form.description || undefined };
        if (dialog.data) await api.patch(`/categories/${dialog.data.id}`, payload);
        else await api.post('/categories', payload);
      } else if (dialog?.kind === 'sub') {
        const payload = { categoryId: dialog.categoryId, name: form.name, description: form.description || undefined };
        if (dialog.data) await api.patch(`/categories/sub/${dialog.data.id}`, payload);
        else await api.post('/categories/sub', payload);
      } else if (dialog?.kind === 'attr') {
        const payload = {
          subCategoryId: dialog.subCategoryId,
          name: form.name,
          label: form.label,
          type: form.type,
          unit: form.unit || undefined,
          options: form.type === 'SELECT' && form.options ? String(form.options).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
          required: !!form.required,
        };
        if (dialog.data) await api.patch(`/categories/attributes/${dialog.data.id}`, payload);
        else await api.post('/categories/attributes', payload);
      }
      toast.success(t('common.saved'));
      setDialog(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (!categories)
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader icon={PageIcon} title={t('categories.title')} subtitle={t('subtitles.categories')} />
        <Button onClick={() => openDialog({ kind: 'category' })}>
          <Plus /> {t('categories.newCategory')}
        </Button>
      </div>

      {categories.map((cat) => (
        <Card key={cat.id}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <button onClick={() => setExpanded((e) => ({ ...e, [cat.id]: !e[cat.id] }))}>
                {expanded[cat.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 rtl:rotate-180" />}
              </button>
              <div className="flex-1">
                <span className="font-semibold">{cat.name}</span>
                {cat.description && <span className="ms-2 text-sm text-muted-foreground">{cat.description}</span>}
              </div>
              <Badge variant="muted">{cat.subCategories.length}</Badge>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openDialog({ kind: 'category', data: cat })}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openDialog({ kind: 'sub', categoryId: cat.id })} title={t('categories.newSubCategory')}>
                <Plus />
              </Button>
              <Button
                variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteTarget({ path: `/categories/${cat.id}`, usagePath: `/categories/${cat.id}/usage` })}
              >
                <Trash2 />
              </Button>
            </div>

            {expanded[cat.id] && (
              <div className="ms-6 mt-3 space-y-3">
                {cat.subCategories.map((sub: any) => (
                  <div key={sub.id} className="rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{sub.name}</span>
                      <div className="flex-1" />
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDialog({ kind: 'sub', categoryId: cat.id, data: sub })}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openDialog({ kind: 'attr', subCategoryId: sub.id })}>
                        <Plus /> {t('categories.newAttribute')}
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget({ path: `/categories/sub/${sub.id}`, usagePath: `/categories/sub/${sub.id}/usage` })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    {sub.attributeDefs.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {sub.attributeDefs.map((a: any) => (
                          <button key={a.id} onClick={() => openDialog({ kind: 'attr', subCategoryId: sub.id, data: a })}>
                            <Badge variant="outline" className="cursor-pointer hover:bg-accent">
                              {a.label}
                              {a.unit ? ` (${a.unit})` : ''} · {a.type}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!dialog} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === 'category' && (dialog.data ? t('common.edit') : t('categories.newCategory'))}
              {dialog?.kind === 'sub' && (dialog.data ? t('common.edit') : t('categories.newSubCategory'))}
              {dialog?.kind === 'attr' && (dialog.data ? t('common.edit') : t('categories.newAttribute'))}
            </DialogTitle>
          </DialogHeader>
          {dialog?.kind !== 'attr' ? (
            <div className="space-y-3">
              <Field label={t('common.name')}>
                <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label={t('categories.description')}>
                <Input value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('categories.attrName')}>
                <Input dir="ltr" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label={t('categories.attrLabel')}>
                <Input value={form.label ?? ''} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </Field>
              <Field label={t('categories.attrType')}>
                <Select value={form.type ?? 'TEXT'} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECT'].map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('categories.attrUnit')}>
                <Input value={form.unit ?? ''} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
              </Field>
              {form.type === 'SELECT' && (
                <Field label={t('categories.attrOptions')} className="col-span-2">
                  <Input value={form.options ?? ''} onChange={(e) => setForm({ ...form, options: e.target.value })} />
                </Field>
              )}
              <div className="flex items-center gap-2">
                <input id="req" type="checkbox" className="h-4 w-4" checked={!!form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} />
                <label htmlFor="req" className="text-sm">{t('categories.required')}</label>
              </div>
              {dialog.data && (
                <div className="col-span-2">
                  <Button
                    variant="destructive" size="sm"
                    onClick={async () => {
                      try { await api.delete(`/categories/attributes/${dialog.data.id}`); toast.success(t('common.deleted')); setDialog(null); load(); }
                      catch (e) { toast.error(errMsg(e)); }
                    }}
                  >
                    <Trash2 /> {t('common.delete')}
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
            <Button onClick={save}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        requireText={t('common.deleteWord')}
        usagePath={deleteTarget?.usagePath}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            const { data } = await api.delete(deleteTarget.path);
            // Report what actually happened rather than always saying "deleted".
            toast.success(data?.mode === 'PURGED' ? t('common.purgedToast') : t('common.archivedToast'));
            load();
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
