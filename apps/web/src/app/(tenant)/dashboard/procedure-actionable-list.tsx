'use client';

import { CheckCircle2, Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Popconfirm } from '@enterprise-platform/shared-ui';

/**
 * Drawer xử lý hồ sơ của Quy trình. Chỉ nạp ở trình duyệt khi có người mở hồ sơ, để bó mã của Dashboard không kéo cả
 * màn Quy trình theo cho người không dùng đến.
 */
const ProcedureInstanceDrawer = dynamic(
  () => import('@enterprise-platform/feature-procedure-engine').then((m) => m.ProcedureInstanceDrawer),
  { ssr: false },
);

export type QuickAction = 'approve' | 'complete';

export interface ActionableProcedure {
  id: string;
  code: string;
  title: string;
  definitionName?: string;
  stepName?: string;
  /** Thao tác bấm nhanh được phép ngay trên dòng (đã tính theo quyền và pha hiện tại ở server component). */
  quickActions: QuickAction[];
}

const COLUMNS = '22px minmax(220px,1fr) 170px 150px 190px 170px';
const QUICK_LABEL: Record<QuickAction, string> = { approve: 'Duyệt', complete: 'Hoàn thành' };

/** Câu hỏi xác nhận nêu rõ hồ sơ và bước đang chốt, để người bấm biết mình chốt gì trước khi hồ sơ đi tiếp. */
export function quickConfirmText(action: QuickAction, item: Pick<ActionableProcedure, 'code' | 'stepName'>) {
  const step = item.stepName ? ` ở bước "${item.stepName}"` : '';
  return action === 'approve'
    ? { title: 'Duyệt hồ sơ này?', description: `Hồ sơ ${item.code} sẽ được duyệt${step} và chuyển sang bước kế tiếp.` }
    : { title: 'Hoàn thành bước này?', description: `Bước${item.stepName ? ` "${item.stepName}"` : ''} của hồ sơ ${item.code} sẽ được đánh dấu hoàn thành.` };
}

/**
 * Danh sách "Hồ sơ cần bạn xử lý" trên Dashboard. Bấm dòng mở drawer xử lý đầy đủ (điền thông tin, tài liệu, trao đổi,
 * tiến trình) ngay tại trang; việc đơn giản (duyệt, hoàn thành) bấm được ngay trên dòng sau một bước xác nhận.
 * Từ chối, trả lại và mọi việc cần ý kiến đi qua drawer.
 */
export function ProcedureActionableList({
  items,
  actor,
}: {
  items: ActionableProcedure[];
  actor: { id: string; name: string };
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  /** Khoá đồng bộ: `busyId` là state nên hai lần bấm sát nhau vẫn thấy giá trị cũ trong cùng một lần render. */
  const working = useRef(false);
  const [error, setError] = useState('');
  /**
   * Hồ sơ vừa bấm nhanh xong: ẩn ngay, không chờ server component nạp lại. Dữ liệu mới về thì bỏ ẩn để hồ sơ vẫn còn
   * việc (bước kế cũng giao cho người này) hiện lại đúng theo server.
   */
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setDone(new Set()), [items]);

  const markDone = (id: string) => setDone((current) => new Set(current).add(id));
  const rows = items.filter((item) => !done.has(item.id));

  async function quick(item: ActionableProcedure, action: QuickAction) {
    if (working.current) return;
    working.current = true;
    setBusyId(item.id);
    setError('');
    try {
      const { applyProcedureAction } = await import('@enterprise-platform/feature-procedure-engine');
      await applyProcedureAction(item.id, action);
      markDone(item.id);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Thao tác không thành công.');
      router.refresh();
    } finally {
      working.current = false;
      setBusyId(undefined);
    }
  }

  return (
    <>
      {error ? (
        <p role="alert" className="m-0 border-t border-red-200 bg-red-50 px-5 py-2 text-[13px] font-semibold text-red-700">
          {error}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <div className="min-w-[820px] py-1">
          <div
            className="grid items-center gap-x-3 px-5 py-2 text-[12px] font-semibold tracking-[0.4px] text-slate-500"
            style={{ gridTemplateColumns: COLUMNS }}
          >
            <span />
            {['HỒ SƠ', 'MÃ HỒ SƠ', 'QUY TRÌNH', 'BƯỚC HIỆN TẠI', 'THAO TÁC'].map((heading) => (
              <span key={heading}>{heading}</span>
            ))}
          </div>
          <ul aria-label="Hồ sơ cần bạn xử lý" className="m-0 list-none p-0">
            {rows.map((item) => (
              <li
                key={item.id}
                className="grid items-center gap-x-3 border-t border-[#f1f3f6] px-5 py-[11px] text-[14px] text-[#18181b] hover:bg-[#f4f6f9]"
                style={{ gridTemplateColumns: COLUMNS }}
              >
                <span aria-hidden className="size-2.5 rounded-full bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,.12)]" />
                <button
                  type="button"
                  onClick={() => setOpenId(item.id)}
                  aria-label={`Mở hồ sơ ${item.code}`}
                  title={item.title}
                  className="cursor-pointer truncate bg-transparent p-0 text-left text-[14px] font-medium text-[#18181b]"
                >
                  {item.title}
                </button>
                <span title={item.code} className="truncate text-[13px] tabular-nums text-slate-600">
                  {item.code}
                </span>
                <span className="truncate text-[13px] text-slate-700">
                  {item.definitionName ? (
                    <span className="rounded-md bg-violet-50 px-2 py-0.5 text-violet-800">{item.definitionName}</span>
                  ) : (
                    '—'
                  )}
                </span>
                <span title={item.stepName} className="truncate text-[13px] text-slate-700">
                  {item.stepName ?? '—'}
                </span>
                <span className="flex items-center gap-1.5">
                  {item.quickActions.map((action) => (
                    <Popconfirm
                      key={action}
                      {...quickConfirmText(action, item)}
                      okText={QUICK_LABEL[action]}
                      cancelText="Quay lại"
                      disabled={busyId !== undefined}
                      onConfirm={() => quick(item, action)}
                    >
                      <button
                        type="button"
                        disabled={busyId !== undefined}
                        className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busyId === item.id ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                        {QUICK_LABEL[action]}
                      </button>
                    </Popconfirm>
                  ))}
                  <button
                    type="button"
                    onClick={() => setOpenId(item.id)}
                    className="h-8 cursor-pointer rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Mở
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {openId ? (
        <ProcedureInstanceDrawer
          instanceId={openId}
          actor={actor}
          onClose={() => setOpenId(undefined)}
          onChanged={() => router.refresh()}
        />
      ) : null}
    </>
  );
}
