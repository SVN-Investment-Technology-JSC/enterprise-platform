'use client';

import {
  CATEGORY_LABELS,
  generateReactComponent,
  generateSvg,
  type BrandPalette,
  type ColorMode,
  type ExportFormat,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';
import { MinimalPopupForm, SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  Braces,
  Check,
  CodeXml,
  Copy,
  Download,
  FileArchive,
  FileImage,
  Globe,
  LayoutGrid,
  LoaderCircle,
  Palette,
  TriangleAlert,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconSvg } from '../icon-svg';
import { copyText, downloadBlob } from './download';
import {
  DEFAULT_CHOICE,
  FORMAT_META,
  formatBytes,
  limitList,
  planExport,
  resolveFaviconDocId,
  runExport,
  toggleFormat,
  usesColorMode,
  type ExportPlan,
} from './export-plan';

export interface ExportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Các icon sẽ xuất; một icon thì xuất lẻ, nhiều icon thì xuất hàng loạt. */
  readonly docs: readonly IconDocument[];
  readonly palette: BrandPalette;
}

const FORMAT_ICONS: Record<ExportFormat, LucideIcon> = {
  svg: FileImage,
  tsx: CodeXml,
  sprite: LayoutGrid,
  json: Braces,
  favicon: Globe,
};

const COLOR_MODES: readonly { id: ColorMode; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'currentColor', label: 'Theo ngữ cảnh', hint: 'Icon lấy màu theo chữ xung quanh (currentColor)', icon: Type },
  { id: 'brand', label: 'Màu thương hiệu', hint: 'Ghi cứng màu thật từ bảng màu thương hiệu', icon: Palette },
];

const COPY_TABS = [
  { id: 'svg', label: 'SVG' },
  { id: 'tsx', label: 'TSX' },
] as const;
type CopyTab = (typeof COPY_TABS)[number]['id'];

const LIST_LIMIT = 200;
const COPIED_MS = 1600;

const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

function RowLabel({ children }: { children: string }) {
  return <span className="pt-2 text-[13px] font-semibold text-slate-600">{children}</span>;
}

export function ExportDialog({ open, onClose, docs, palette }: ExportDialogProps) {
  const [formats, setFormats] = useState<readonly ExportFormat[]>(DEFAULT_CHOICE.formats);
  const [colorMode, setColorMode] = useState<ColorMode>(DEFAULT_CHOICE.colorMode);
  const [faviconPick, setFaviconPick] = useState('');
  const [plan, setPlan] = useState<ExportPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Cảnh báo của lần xuất thật gần nhất; null khi chưa xuất hoặc đã đổi lựa chọn. */
  const [exported, setExported] = useState<readonly string[] | null>(null);
  const [codeTab, setCodeTab] = useState<CopyTab>('svg');
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setFormats(DEFAULT_CHOICE.formats);
    setColorMode(DEFAULT_CHOICE.colorMode);
    setFaviconPick('');
    setPlan(null);
    setPlanError(null);
    setError(null);
    setExported(null);
    setCodeTab('svg');
    setCopied(false);
  }, [open]);

  const faviconId = resolveFaviconDocId(docs, faviconPick);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setExported(null);
    planExport(docs, palette, { formats, colorMode, faviconDocId: faviconId })
      .then((result) => {
        if (cancelled) return;
        setPlan(result);
        setPlanError(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setPlan(null);
        setPlanError(messageOf(reason, 'Không tính được danh sách tệp.'));
      });
    return () => {
      cancelled = true;
    };
  }, [open, docs, palette, formats, colorMode, faviconId]);

  const single = docs.length === 1 ? docs[0] : null;
  const code = useMemo(() => {
    if (!single) return null;
    return {
      svg: generateSvg(single, { colorMode, palette }),
      tsx: generateReactComponent(single, { colorMode, palette }),
    } satisfies Record<CopyTab, string>;
  }, [single, colorMode, palette]);

  const colorApplies = usesColorMode(formats);
  const canDownload = !busy && plan !== null && plan.files.length > 0;
  const warnings = exported ?? plan?.warnings ?? [];
  const list = limitList(plan?.files ?? [], LIST_LIMIT);

  const handleCopy = async () => {
    if (!code) return;
    const ok = await copyText(code[codeTab]);
    if (!alive.current) return;
    if (!ok) {
      setError('Không sao chép được, hãy thử tải về.');
      return;
    }
    setError(null);
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  };

  const handleDownload = async () => {
    if (!canDownload) return;
    setBusy(true);
    setError(null);
    try {
      const result = await runExport(docs, palette, { formats, colorMode, faviconDocId: faviconId });
      downloadBlob(result.filename, result.data, result.mime);
      if (!alive.current) return;
      if (result.warnings.length === 0) onClose();
      else setExported(result.warnings);
    } catch (reason) {
      if (alive.current) setError(messageOf(reason, 'Không xuất được tệp.'));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <MinimalPopupForm
      isOpen={open}
      isSubmitting={busy}
      maxWidth={640}
      onClose={onClose}
      subtitle={single ? single.name : docs.length > 0 ? `${docs.length} icon` : 'Chưa chọn icon'}
      title="Xuất icon"
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[84px_minmax(0,1fr)] items-start gap-x-3 gap-y-3.5">
          <RowLabel>Định dạng</RowLabel>
          <div aria-label="Định dạng xuất" className="flex flex-wrap gap-2" role="group">
            {FORMAT_META.map((meta) => {
              const Icon = FORMAT_ICONS[meta.id];
              const on = formats.includes(meta.id);
              return (
                <button
                  aria-checked={on}
                  className={`inline-flex h-9 items-center gap-1.5 rounded border px-3 text-sm font-medium transition-colors ${
                    on
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-[#d1d5db] bg-white text-[#4b5563] hover:bg-slate-50'
                  }`}
                  disabled={busy}
                  key={meta.id}
                  onClick={() => setFormats((current) => toggleFormat(current, meta.id))}
                  role="checkbox"
                  title={meta.hint}
                  type="button"
                >
                  <Icon aria-hidden size={16} />
                  {meta.label}
                  {on ? <Check aria-hidden className="-mr-0.5" size={14} /> : null}
                </button>
              );
            })}
          </div>

          <RowLabel>Màu</RowLabel>
          <div
            aria-label="Chế độ màu"
            className={`inline-flex w-fit rounded border border-[#d1d5db] bg-white p-0.5 ${colorApplies ? '' : 'opacity-50'}`}
            role="radiogroup"
            title={colorApplies ? undefined : 'Chỉ áp dụng cho SVG, React TSX và Sprite'}
          >
            {COLOR_MODES.map((mode) => {
              const Icon = mode.icon;
              const on = colorMode === mode.id;
              return (
                <button
                  aria-checked={on}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-[13px] font-medium transition-colors ${
                    on ? 'bg-blue-600 !text-white' : 'text-[#4b5563] hover:bg-slate-100'
                  }`}
                  disabled={busy || !colorApplies}
                  key={mode.id}
                  onClick={() => setColorMode(mode.id)}
                  role="radio"
                  title={mode.hint}
                  type="button"
                >
                  <Icon aria-hidden size={15} />
                  {mode.label}
                </button>
              );
            })}
          </div>

          {docs.length > 1 && formats.includes('favicon') ? (
            <>
              <RowLabel>Icon favicon</RowLabel>
              <SearchableSelect
                disabled={busy}
                height={36}
                onChange={setFaviconPick}
                options={docs.map((doc) => ({ value: doc.id, label: doc.name, badge: CATEGORY_LABELS[doc.category] }))}
                placeholder="Chọn icon"
                value={faviconId}
              />
            </>
          ) : null}
        </div>

        {single && code ? (
          <section className="flex gap-3 border-t border-[#e5e7eb] pt-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded border border-slate-200 bg-white text-slate-800">
              <IconSvg className="h-9 w-9" colorMode={colorMode} doc={single} palette={palette} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div aria-label="Mã xem trước" className="inline-flex gap-1" role="tablist">
                  {COPY_TABS.map((tab) => (
                    <button
                      aria-selected={codeTab === tab.id}
                      className={`h-7 rounded px-2.5 text-xs font-semibold transition-colors ${
                        codeTab === tab.id ? 'bg-slate-800 !text-white' : 'text-slate-500 hover:bg-slate-100'
                      }`}
                      key={tab.id}
                      onClick={() => {
                        setCodeTab(tab.id);
                        setCopied(false);
                      }}
                      role="tab"
                      type="button"
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <button
                  className="inline-flex h-7 items-center gap-1.5 rounded border border-[#d1d5db] px-2.5 text-xs font-medium text-[#4b5563] transition-colors hover:bg-slate-100"
                  onClick={handleCopy}
                  title={`Sao chép mã ${codeTab === 'svg' ? 'SVG' : 'TSX'}`}
                  type="button"
                >
                  {copied ? <Check aria-hidden className="text-emerald-600" size={14} /> : <Copy aria-hidden size={14} />}
                  {copied ? 'Đã chép' : 'Sao chép'}
                </button>
              </div>
              <pre className="max-h-36 overflow-auto rounded border border-slate-200 bg-white p-2 text-[11px] leading-4 text-slate-700">
                {code[codeTab]}
              </pre>
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-1.5 border-t border-[#e5e7eb] pt-4">
          <div className="flex items-center justify-between gap-3 text-[13px] text-slate-600">
            <span className="font-semibold text-slate-700">
              {plan ? `${plan.files.length} tệp` : planError ? 'Lỗi' : 'Đang tính…'}
              {plan && plan.files.length > 0 ? <span className="ml-1.5 font-normal tabular-nums text-slate-500">~{formatBytes(plan.downloadBytes)}</span> : null}
            </span>
            {plan && plan.files.length > 0 ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-slate-500" title="Tên tệp sẽ tải về">
                {plan.asZip ? <FileArchive aria-hidden className="shrink-0" size={14} /> : <Download aria-hidden className="shrink-0" size={14} />}
                <span className="truncate font-mono">{plan.downloadName}</span>
              </span>
            ) : null}
          </div>
          {plan && plan.files.length > 0 ? (
            <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto text-xs [scrollbar-width:thin]">
              {list.shown.map((file) => (
                <li className="flex items-center justify-between gap-3 py-1" key={file.path}>
                  <span className="truncate font-mono text-slate-700">{file.path}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {file.estimated ? '~' : ''}
                    {formatBytes(file.bytes)}
                  </span>
                </li>
              ))}
              {list.hidden > 0 ? <li className="py-1 text-slate-500">và {list.hidden} tệp khác</li> : null}
            </ul>
          ) : null}
        </section>

        {exported ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700" role="status">
            <Check aria-hidden size={14} />
            Đã tải về
          </p>
        ) : null}
        {warnings.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs text-amber-700">
            {warnings.map((warning) => (
              <li className="flex items-start gap-1.5" key={warning}>
                <TriangleAlert aria-hidden className="mt-px shrink-0" size={14} />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {error || planError ? (
          <p className="text-xs text-red-600" role="alert">
            {error ?? planError}
          </p>
        ) : null}

        <div className="flex justify-end gap-3 border-t border-[#e5e7eb] pt-4">
          <button
            className="h-10 rounded border border-[#d1d5db] bg-transparent px-4 text-sm font-medium text-[#4b5563] transition-colors hover:bg-[#e5e5e5] disabled:opacity-50"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            {exported ? 'Đóng' : 'Hủy'}
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded bg-blue-600 px-5 text-sm font-bold !text-white transition-colors hover:bg-blue-700 disabled:bg-blue-300"
            disabled={!canDownload}
            onClick={handleDownload}
            type="button"
          >
            {busy ? <LoaderCircle aria-hidden className="animate-spin" size={16} /> : <Download aria-hidden size={16} />}
            {busy ? 'Đang xử lý…' : 'Tải về'}
          </button>
        </div>
      </div>
    </MinimalPopupForm>
  );
}
