'use client';

import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { errorMessage } from '../store/brand-api';
import type { IconLibrary, SyncResult } from '../store';

interface Outcome {
  readonly tone: 'ok' | 'error';
  readonly text: string;
}

function describe(result: SyncResult): Outcome {
  if (result.failed === 0) return { tone: 'ok', text: `Đã đồng bộ ${result.pushed} icon.` };
  const done = result.pushed > 0 ? `Đã đồng bộ ${result.pushed} icon, ` : '';
  return { tone: 'error', text: `${done}${result.failed} icon chưa đồng bộ được. Thử lại sau.` };
}

/**
 * Dải mỏng báo icon đang được lưu ở đâu: máy chủ hay tạm trong trình duyệt. Khi máy chủ dùng được mà trình duyệt
 * còn icon chưa có trên máy chủ thì có nút đồng bộ; kết quả đồng bộ hiện ngay cạnh nút.
 */
export function SyncBanner({ library }: { readonly library: IconLibrary }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (library.mode === 'checking') return null;
  const server = library.mode === 'server';

  const sync = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome(describe(await library.syncLocalToServer()));
    } catch (error) {
      setOutcome({ tone: 'error', text: errorMessage(error, 'Không đồng bộ được. Thử lại sau.') });
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      await library.reloadFromServer();
    } catch {
      // Vẫn không nối được: dải trạng thái giữ nguyên chế độ cục bộ.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-600"
      data-testid="sync-banner"
    >
      <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
        <span aria-hidden className={cn('size-1.5 rounded-full', server ? 'bg-emerald-500' : 'bg-amber-500')} />
        {server ? 'Đã kết nối máy chủ' : 'Đang lưu tạm trong trình duyệt'}
      </span>

      {!server && library.modeReason ? <span className="text-slate-500">{library.modeReason}</span> : null}

      {library.loading || busy ? (
        <span className="inline-flex items-center gap-1 text-slate-500">
          <LoaderCircle aria-hidden className="size-3 animate-spin" />
          {busy ? (server ? 'Đang đồng bộ' : 'Đang kết nối') : 'Đang tải'}
        </span>
      ) : null}

      {server && library.localOnlyCount > 0 ? (
        <>
          <span>{library.localOnlyCount} icon chỉ có trong trình duyệt</span>
          <Button className="h-6 rounded-md px-2 text-xs" disabled={busy} onClick={sync} size="sm" variant="outline">
            Đồng bộ lên máy chủ ({library.localOnlyCount})
          </Button>
        </>
      ) : null}

      {!server ? (
        <Button className="h-6 rounded-md px-2 text-xs" disabled={busy} onClick={retry} size="sm" variant="ghost">
          Thử lại
        </Button>
      ) : null}

      {outcome ? (
        <span className={outcome.tone === 'ok' ? 'text-emerald-700' : 'text-red-700'} role={outcome.tone === 'error' ? 'alert' : 'status'}>
          {outcome.text}
        </span>
      ) : null}
    </div>
  );
}
