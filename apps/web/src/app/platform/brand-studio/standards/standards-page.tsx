'use client';

import { Popconfirm } from '@enterprise-platform/shared-ui';
import { Download, Info, RotateCcw, Upload, X } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { downloadTextFile, readFileText } from '../library/file-download';
import { IconButton } from '../library/library-ui';
import { useBrandSettings, useIconLibrary } from '../store';
import { PaletteEditor } from './palette-editor';
import { PalettePreview } from './palette-preview';
import { RulesEditor } from './rules-editor';
import { parseSettings, serializeSettings, settingsFileName } from './settings-io';

interface Notice {
  readonly tone: 'ok' | 'error';
  readonly text: string;
}

const SECTION_TITLE = 'border-b border-slate-200 pb-2 text-base font-semibold text-slate-900';

export function StandardsPage() {
  const settings = useBrandSettings();
  const library = useIconLibrary();
  const [notice, setNotice] = useState<Notice | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const exportSettings = () => {
    downloadTextFile(settingsFileName(), serializeSettings(settings.palette, settings.rules));
    setNotice({ tone: 'ok', text: 'Đã xuất cài đặt.' });
  };

  const importSettings = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = parseSettings(await readFileText(file));
      if (parsed.palette) settings.setPalette(parsed.palette);
      if (parsed.rules) settings.setRules(parsed.rules);
      const parts = [
        parsed.palette ? `bảng màu (${parsed.palette.tokens.length} màu)` : null,
        parsed.rules ? 'quy chuẩn' : null,
      ].filter(Boolean);
      const skipped = parsed.skippedColors > 0 ? ` Bỏ qua ${parsed.skippedColors} màu sai mã hoặc trùng khoá.` : '';
      setNotice({ tone: 'ok', text: `Đã nhập ${parts.join(' và ')}.${skipped}` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Không đọc được tệp.' });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Bảng màu & quy chuẩn</h1>
          {settings.saving ? <span className="text-xs text-slate-500">Đang lưu lên máy chủ</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="rounded-md"
            onClick={() => fileInput.current?.click()}
            title="Nhập cài đặt từ tệp JSON"
            variant="outline"
          >
            <Upload aria-hidden className="size-4" />
            <span className="hidden sm:inline">Nhập</span>
          </Button>
          <Button className="rounded-md" onClick={exportSettings} title="Xuất cài đặt ra tệp JSON" variant="outline">
            <Download aria-hidden className="size-4" />
            <span className="hidden sm:inline">Xuất</span>
          </Button>
          <Popconfirm
            cancelText="Hủy"
            description="Bảng màu và quy chuẩn trở về mặc định; icon không bị đổi."
            okText="Đặt lại"
            okType="warning"
            onConfirm={() => {
              settings.reset();
              setNotice({ tone: 'ok', text: 'Đã đặt lại bảng màu và quy chuẩn mặc định.' });
            }}
            placement="bottom-end"
            title="Đặt lại mặc định?"
          >
            <Button className="rounded-md" title="Đặt lại mặc định" variant="outline">
              <RotateCcw aria-hidden className="size-4" />
              <span className="hidden sm:inline">Đặt lại</span>
            </Button>
          </Popconfirm>
          <input
            accept=".json,application/json"
            aria-hidden
            className="sr-only"
            data-testid="settings-input"
            onChange={importSettings}
            ref={fileInput}
            tabIndex={-1}
            type="file"
          />
        </div>
      </header>

      {notice ? (
        <div
          className={cn(
            'flex items-start gap-2 border-l-2 py-1.5 pl-3 pr-1 text-sm',
            notice.tone === 'ok' ? 'border-emerald-500 bg-emerald-50/60 text-emerald-800' : 'border-red-500 bg-red-50/60 text-red-800',
          )}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          <p className="min-w-0 flex-1">{notice.text}</p>
          <IconButton className="size-6" label="Đóng thông báo" onClick={() => setNotice(null)}>
            <X aria-hidden className="size-3.5" />
          </IconButton>
        </div>
      ) : null}

      {library.error ? (
        <p className="border-l-2 border-red-500 bg-red-50/60 py-1.5 pl-3 text-sm text-red-800" role="alert">
          {library.error}
        </p>
      ) : null}

      {settings.error ? (
        <p className="border-l-2 border-red-500 bg-red-50/60 py-1.5 pl-3 text-sm text-red-800" role="alert">
          {settings.error}
        </p>
      ) : null}

      {!settings.ready || !library.ready ? (
        <div aria-busy="true" aria-label="Đang tải cài đặt" className="grid animate-pulse gap-3">
          <div className="h-6 w-48 rounded bg-slate-100" />
          <div className="h-48 rounded bg-slate-100" />
        </div>
      ) : (
        <div className="grid gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section aria-labelledby="palette-title" className="flex min-w-0 flex-col gap-4">
            <div>
              <h2 className={SECTION_TITLE} id="palette-title">
                Bảng màu thương hiệu
              </h2>
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                <Info aria-hidden className="mt-px size-3.5 shrink-0" />
                Bảng màu hiện là bản tạm, chờ ban lãnh đạo chốt bảng màu chính thức.
              </p>
            </div>
            <PaletteEditor docs={library.docs} onChange={settings.setPalette} palette={settings.palette} />
            <PalettePreview docs={library.docs} palette={settings.palette} />
          </section>

          <section aria-labelledby="rules-title" className="flex min-w-0 flex-col gap-2">
            <h2 className={SECTION_TITLE} id="rules-title">
              Quy chuẩn
            </h2>
            <RulesEditor onChange={settings.setRules} rules={settings.rules} />
          </section>
        </div>
      )}
    </div>
  );
}
