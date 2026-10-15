'use client';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import { hrmFetch } from '../hrm-api';
import { AuditDetailList, auditStamp, type AuditRow } from './hrm-audit-trail';
import { Button } from './button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './sheet';
import { EmptyPanel, InfoNote, StatusPill } from './settings-kit';

interface AuditPage {
  data: AuditRow[];
  meta: { total: number; actions: { value: string; label: string }[] };
}

const PER_ACTION = 50;
const MAX_ROWS = 100;

/**
 * Lịch sử thay đổi của một nhóm cấu hình, lấy từ nhật ký nghiệp vụ (`GET operations/audit`, cần quyền hrm.audit.read).
 * Nhật ký lọc theo MỘT mã hành động, nên ngăn kéo lấy danh sách mã hành động có trong hệ thống, giữ các mã bắt đầu bằng
 * một trong `actionPrefixes` (ví dụ `request_reason.`, `request_type.`), gọi song song theo từng mã rồi gộp theo thời gian.
 * Không đổi dữ liệu nào.
 */
export function ConfigHistoryDrawer({
  open,
  onOpenChange,
  title = 'Lịch sử thay đổi',
  description,
  actionPrefixes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  actionPrefixes: readonly string[];
}) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const prefixKey = actionPrefixes.join('|');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRows(null);
    setError('');
    setExpanded(null);
    (async () => {
      const first = await hrmFetch<AuditPage>('/operations/audit?page=1&pageSize=1');
      const wanted = first.meta.actions.filter((a) => actionPrefixes.some((p) => a.value.startsWith(p)));
      const pages = await Promise.all(
        wanted.map((a) =>
          hrmFetch<AuditPage>(`/operations/audit?action=${encodeURIComponent(a.value)}&page=1&pageSize=${PER_ACTION}`),
        ),
      );
      const merged = pages
        .flatMap((p) => p.data)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, MAX_ROWS);
      if (alive) setRows(merged);
    })().catch((e) => {
      if (alive) setError(e instanceof Error ? e.message : 'Không tải được lịch sử thay đổi');
    });
    return () => {
      alive = false;
    };
    // actionPrefixes là mảng mới mỗi lần vẽ; khoá theo nội dung.
  }, [open, prefixKey]);

  const reasonOf = useMemo(
    () => (row: AuditRow) => {
      const d = row.detail && typeof row.detail === 'object' ? (row.detail as Record<string, unknown>) : {};
      const value = d.reason ?? d.note;
      return typeof value === 'string' && value.trim() ? value : '';
    },
    [],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-white p-0 sm:max-w-[640px]">
        <SheetHeader className="shrink-0 border-b border-slate-200">
          <SheetTitle className="flex items-center gap-2">
            <History aria-hidden="true" className="size-4 text-slate-500" />
            {title}
          </SheetTitle>
          <SheetDescription>{description ?? 'Các thay đổi gần đây (tối đa 100 bản ghi), mới nhất ở trên.'}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4">
          {error ? (
            <InfoNote tone="red" role="alert">
              {error}
            </InfoNote>
          ) : rows === null ? (
            <p role="status" className="py-10 text-center text-xs text-slate-500">
              Đang tải lịch sử thay đổi...
            </p>
          ) : rows.length === 0 ? (
            <EmptyPanel icon={History} title="Chưa có thay đổi nào được ghi nhận" />
          ) : (
            <ol className="space-y-2">
              {rows.map((row) => {
                const isOpen = expanded === row.id;
                const reason = reasonOf(row);
                return (
                  <li key={row.id} className="rounded-xl border border-slate-200 bg-white text-xs">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : row.id)}
                      className="flex w-full cursor-pointer items-start gap-2 p-3 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
                      ) : (
                        <ChevronRight aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                          <StatusPill tone="blue">{row.actionLabel}</StatusPill>
                          <span className="text-[12px] text-slate-500">{auditStamp(row.createdAt)}</span>
                        </span>
                        {row.entityLabel ? (
                          <span className="mt-1 block break-words font-semibold text-slate-800">{row.entityLabel}</span>
                        ) : null}
                        <span className="block text-[12px] text-slate-500">Người thực hiện: {row.actorLabel}</span>
                        {reason ? <span className="mt-0.5 block break-words text-slate-600">Ghi chú: {reason}</span> : null}
                      </span>
                    </button>
                    {isOpen ? (
                      <div className="border-t border-slate-100 p-3">
                        {row.detail && typeof row.detail === 'object' ? (
                          <AuditDetailList data={row.detail as Record<string, unknown>} />
                        ) : (
                          <p className="text-slate-500">Không có thông tin thêm.</p>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <div className="flex shrink-0 justify-end border-t border-slate-200 bg-white px-4 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
