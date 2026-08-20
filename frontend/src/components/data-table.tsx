'use client';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpDown, ArrowUp, ArrowDown, Search, ChevronLeft, ChevronRight, Inbox, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { invalidateCache } from '../lib/cache';
import { useLocalStorageCache } from '../lib/use-local-storage-cache';
import { cn } from '../lib/utils';
import ConfirmDialog from './confirm-dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { Skeleton } from './ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

export interface Column<T = any> {
  key: string;
  label: ReactNode;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  className?: string;
  /**
   * How this column behaves in the phone card layout.
   * `hide` drops it, `primary` promotes it to the card's heading. Left unset,
   * the first column becomes the heading and the rest render as label/value.
   */
  mobile?: 'primary' | 'hide';
}

interface Props {
  endpoint: string;
  columns: Column[];
  searchable?: boolean;
  extraParams?: Record<string, any>;
  toolbar?: ReactNode;
  filters?: ReactNode;
  onRowClick?: (row: any) => void;
  refreshKey?: number;
  initialSearch?: string;
  /**
   * Pass both to show the Active/Archive switch. The page owns the state so it
   * can swap its row actions (Edit/Archive vs Restore) to match the view.
   */
  archived?: boolean;
  onArchivedChange?: (archived: boolean) => void;
  /** Enable or disable batch delete feature. Defaults to true. */
  canBatchDelete?: boolean;
  /** Custom batch delete handler */
  onBatchDelete?: (selectedIds: string[], selectedRows: any[]) => Promise<void>;
}

export default function DataTable({
  endpoint, columns, searchable = true, extraParams, toolbar, filters, onRowClick, refreshKey, initialSearch,
  archived = false, onArchivedChange, canBatchDelete = true, onBatchDelete,
}: Props) {
  const t = useTranslations();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState(initialSearch ?? '');
  const [debounced, setDebounced] = useState(initialSearch ?? '');
  const [sortBy, setSortBy] = useState<string | undefined>();
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo(
    () => ({
      page,
      pageSize,
      search: debounced || undefined,
      sortBy,
      sortDir: sortBy ? sortDir : undefined,
      // Only sent when viewing the archive, so active lists keep their existing
      // cache keys and stay warm.
      archived: archived ? 'true' : undefined,
      ...extraParams,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, pageSize, debounced, sortBy, sortDir, archived, JSON.stringify(extraParams)],
  );

  // Switching view resets paging — page 4 of the active list rarely exists in
  // the archive.
  useEffect(() => {
    setPage(1);
  }, [archived]);

  /** Resource name, e.g. `/purchase-orders` -> `purchase-orders`. */
  const resource = endpoint.replace(/^\/+/, '');
  // One cache entry per distinct query, all sharing the `resource` prefix so a
  // single invalidation clears every page/sort/filter combination at once.
  const cacheKey = `${resource}:${JSON.stringify(query)}`;

  const fetcher = useCallback(async () => {
    const r = await api.get(endpoint, { params: query });
    return Array.isArray(r.data)
      ? { rows: r.data as any[], total: r.data.length }
      : { rows: (r.data.items ?? []) as any[], total: (r.data.total ?? 0) as number };
  }, [endpoint, query]);

  const { data, loading, validating, refresh } = useLocalStorageCache(cacheKey, fetcher);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  // Pages bump `refreshKey` after a create/update/delete. Treat that as the
  // write signal: drop every cached query for this resource and refetch. The
  // invalidation bus also reaches other tabs and any other mounted table on
  // the same resource.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    invalidateCache(resource);
  }, [refreshKey, resource]);

  // Clear selections when page, search, or filters change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, debounced, archived, JSON.stringify(extraParams)]);

  const selectableRows = useMemo(() => rows.filter((r) => r && r.id), [rows]);
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selectedIds.has(r.id));
  const someSelected = selectableRows.some((r) => selectedIds.has(r.id));

  const toggleSelectAll = (e?: React.MouseEvent | React.ChangeEvent) => {
    if (e) e.stopPropagation();
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableRows.map((r) => r.id)));
    }
  };

  const toggleSelectRow = (id: string, e?: React.MouseEvent | React.ChangeEvent) => {
    if (e) e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setBatchDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      if (onBatchDelete) {
        const selectedRows = rows.filter((r) => selectedIds.has(r.id));
        await onBatchDelete(ids, selectedRows);
      } else {
        const results = await Promise.allSettled(
          ids.map((id) => api.delete(`${endpoint}/${id}`))
        );
        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (succeeded > 0) {
          toast.success(t('common.deletedCount', { count: succeeded }));
        }
        if (failed > 0) {
          toast.error(t('common.failedToDeleteCount', { count: failed }));
        }
      }
      invalidateCache(resource);
      setSelectedIds(new Set());
      setConfirmOpen(false);
      setSelectionMode(false);
      void refresh();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBatchDeleting(false);
    }
  };

  const toggleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  /*
   * Phone layout. A ten-column table on a 390px screen is either a horizontal
   * scroll hunt or unreadable, so each row becomes a card: one heading line and
   * the rest as label/value pairs. Columns with a blank label (the row-action
   * buttons) are pulled out and pinned to the card's footer, where they stay
   * reachable with a thumb.
   */
  const isBlank = (l: ReactNode) => l === '' || l === null || l === undefined;
  const shown = columns.filter((c) => c.mobile !== 'hide');
  const actionCols = shown.filter((c) => isBlank(c.label));
  const dataCols = shown.filter((c) => !isBlank(c.label));
  const headingCol = dataCols.find((c) => c.mobile === 'primary') ?? dataCols[0];
  const detailCols = dataCols.filter((c) => c !== headingCol);
  const cell = (c: Column, row: any) => (c.render ? c.render(row) : (row[c.key] ?? '—'));

  const cards = (
    <div className="divide-y">
      {loading ? (
        Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
          <Inbox className="h-8 w-8 opacity-50" />
          <span className="text-sm">{t('common.noRecords')}</span>
        </div>
      ) : (
        rows.map((row, i) => (
          <div
            key={row.id ?? i}
            className={cn(
              'p-4 transition-colors',
              (onRowClick || selectionMode) && 'cursor-pointer active:bg-muted/50',
              row.id && selectedIds.has(row.id) && 'bg-destructive/5 dark:bg-destructive/10'
            )}
            onClick={(e) => {
              if (selectionMode && row.id) {
                toggleSelectRow(row.id, e);
              } else {
                onRowClick?.(row);
              }
            }}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              {selectionMode && row.id && (
                <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input cursor-pointer accent-primary"
                    checked={selectedIds.has(row.id)}
                    onChange={() => toggleSelectRow(row.id)}
                  />
                </div>
              )}
              <div className="flex-1 min-w-0 font-medium">
                {headingCol && cell(headingCol, row)}
              </div>
            </div>
            <dl className="space-y-1.5">
              {detailCols.map((c) => (
                <div key={c.key} className="flex items-start justify-between gap-3 text-sm">
                  <dt className="shrink-0 text-muted-foreground">{c.label}</dt>
                  <dd className="min-w-0 text-end">{cell(c, row)}</dd>
                </div>
              ))}
            </dl>
            {actionCols.length > 0 && !selectionMode && (
              <div className="mt-3 flex justify-end gap-1 border-t pt-3">
                {actionCols.map((c) => (
                  <div key={c.key}>{cell(c, row)}</div>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="rounded-lg border bg-card">
      <div className="no-print flex flex-wrap items-center gap-2 border-b p-3">
        {searchable && (
          <div className="relative w-full sm:w-64">
            <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-8"
              placeholder={t('common.search')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        )}
        {filters}
        {/*
          Active / Archive switch. A segmented control rather than a checkbox so
          it is obvious which set is on screen — an archive that looks like the
          normal list is how records get "deleted twice". Uses logical padding
          so it mirrors correctly in Arabic.
        */}
        {onArchivedChange && (
          <div className="inline-flex rounded-md border p-0.5" role="group">
            {[false, true].map((mode) => (
              <button
                key={String(mode)}
                type="button"
                onClick={() => onArchivedChange(mode)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  archived === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {mode ? t('common.archived') : t('common.active')}
              </button>
            ))}
          </div>
        )}
        {canBatchDelete && (
          <Button
            type="button"
            variant={selectionMode ? 'destructive' : 'outline'}
            size="icon"
            className={cn(
              'h-9 w-9 shrink-0 transition-colors',
              selectionMode
                ? 'bg-destructive text-destructive-foreground'
                : 'text-muted-foreground hover:text-destructive hover:border-destructive/40'
            )}
            title={t('common.selectToDelete')}
            onClick={() => {
              setSelectionMode((prev) => !prev);
              if (selectionMode) setSelectedIds(new Set());
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        <div className="flex-1" />
        {toolbar}
      </div>

      {selectionMode && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-destructive/5 px-4 py-2.5 animate-in fade-in duration-150">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-destructive">
              {selectedIds.size} {t('common.selected')}
            </span>
            {selectableRows.length > 0 && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                onClick={toggleSelectAll}
              >
                {allSelected ? t('common.deselectAll') : `${t('common.selectAll')} (${selectableRows.length})`}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={selectedIds.size === 0 || batchDeleting}
              onClick={() => setConfirmOpen(true)}
              className="h-8 gap-1.5 text-xs font-medium"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{t('common.delete')} {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectionMode(false);
                setSelectedIds(new Set());
              }}
              className="h-8 text-xs"
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      <div className="sm:hidden">{cards}</div>
      <div className="hidden sm:block">
      <Table>
        <TableHeader>
          <TableRow>
            {selectionMode && (
              <TableHead className="w-10 px-3 text-center">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input cursor-pointer accent-primary align-middle"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={toggleSelectAll}
                />
              </TableHead>
            )}
            {columns.map((c) => (
              <TableHead key={c.key} className={c.className}>
                {c.sortable ? (
                  <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sortBy === c.key ? (
                      sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                    )}
                  </button>
                ) : (
                  c.label
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>
                {selectionMode && (
                  <TableCell className="w-10 px-3">
                    <Skeleton className="h-4 w-4 rounded" />
                  </TableCell>
                )}
                {columns.map((c) => (
                  <TableCell key={c.key}>
                    <Skeleton className="h-4 w-full max-w-32" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length + (selectionMode ? 1 : 0)}>
                <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                  <Inbox className="h-8 w-8 opacity-50" />
                  <span className="text-sm">{t('common.noRecords')}</span>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, i) => (
              <TableRow
                key={row.id ?? i}
                className={cn(
                  (onRowClick || selectionMode) && 'cursor-pointer',
                  row.id && selectedIds.has(row.id) && 'bg-destructive/5 dark:bg-destructive/10'
                )}
                onClick={(e) => {
                  if (selectionMode && row.id) {
                    toggleSelectRow(row.id, e);
                  } else {
                    onRowClick?.(row);
                  }
                }}
              >
                {selectionMode && (
                  <TableCell
                    className="w-10 px-3 text-center"
                    onClick={(e) => {
                      if (row.id) toggleSelectRow(row.id, e);
                    }}
                  >
                    {row.id ? (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input cursor-pointer accent-primary align-middle"
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggleSelectRow(row.id)}
                      />
                    ) : null}
                  </TableCell>
                )}
                {columns.map((c) => (
                  <TableCell key={c.key} className={c.className}>
                    {c.render ? c.render(row) : (row[c.key] ?? '—')}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      </div>
      <div className="no-print flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>{t('common.rowsPerPage')}</span>
          <Select
            className="w-20"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('transition-opacity', validating && 'opacity-50')}>
            {t('common.page')} {page} {t('common.of')} {totalPages} · {total}
          </span>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="rtl:rotate-180" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="rtl:rotate-180" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('common.deleteSelected')}
        description={t('common.confirmBatchDelete', { count: selectedIds.size })}
        onConfirm={handleBatchDelete}
      />
    </div>
  );
}
