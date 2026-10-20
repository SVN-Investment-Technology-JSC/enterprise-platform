'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Check,
  Circle,
  Code2,
  Copy,
  Download,
  Eye,
  FileJson,
  Grid,
  Hexagon,
  Layers,
  Palette,
  Plus,
  RotateCcw,
  Shield,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import {
  BRAND_COLORS,
  BUILTIN_GLYPHS,
  SVNDTS_ICON_PRESETS,
  type BrandColorKey,
  type ContainerFill,
  type ContainerShape,
  type ExportColorMode,
  type StructuredIconSpec,
} from './brand-icon.types';
import {
  downloadSvgFile,
  generateCleanSvg,
  generateReactComponent,
  isValidPathData,
  resolveGlyphScale,
} from './brand-icon-generator';
import { mergeWithPresets, normalizeIconList, parseIconLibrary } from './brand-icon-library';
import { BrandIconSvg } from './brand-icon-svg';
import { looksLikeSvgMarkup, svgMarkupToPathData } from './brand-icon-svg-import';
import { NewIconDialog } from './new-icon-dialog';

const SHAPE_OPTIONS: { id: ContainerShape; label: string; icon: typeof Square }[] = [
  { id: 'squircle', label: 'Squircle bo góc', icon: Square },
  { id: 'shield', label: 'Khiên bảo mật', icon: Shield },
  { id: 'hexagon', label: 'Lục giác công nghệ', icon: Hexagon },
  { id: 'circle', label: 'Hình tròn', icon: Circle },
  { id: 'diamond', label: 'Hình thoi', icon: Sparkles },
  { id: 'none', label: 'Không khung', icon: Layers },
];

const LOCAL_STORAGE_KEY = 'svndts-brand-studio-icons';

export function BrandStudioConsole() {
  const [iconsList, setIconsList] = useState<StructuredIconSpec[]>(SVNDTS_ICON_PRESETS);
  const [selectedIconId, setSelectedIconId] = useState<string>('svndts-master');
  const [iconSpec, setIconSpec] = useState<StructuredIconSpec>({ ...SVNDTS_ICON_PRESETS[0] });
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [activeCodeTab, setActiveCodeTab] = useState<'svg' | 'tsx'>('svg');
  const [copiedType, setCopiedType] = useState<'svg' | 'tsx' | null>(null);
  const [activeInspectorTab, setActiveInspectorTab] = useState<'style' | 'glyph' | 'custom-path'>('style');
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);
  const [colorMode, setColorMode] = useState<ExportColorMode>('currentColor');
  const [libraryMessage, setLibraryMessage] = useState<string | null>(null);
  const [pathImportNote, setPathImportNote] = useState<{
    field: 'glyphPath' | 'secondaryPath';
    tone: 'ok' | 'error';
    messages: string[];
  } | null>(null);

  // Tải danh sách icon từ LocalStorage khi khởi tạo
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const { icons } = normalizeIconList(JSON.parse(saved));
        if (icons.length > 0) {
          const merged = mergeWithPresets(icons);
          setIconsList(merged);
          setSelectedIconId(merged[0].id);
          setIconSpec({ ...merged[0] });
        }
      }
    } catch {
      // Bỏ qua nếu localStorage bị chặn
    }
  }, []);

  // Lưu tự động vào LocalStorage khi iconsList thay đổi
  const saveToStorage = (updatedList: StructuredIconSpec[]) => {
    setIconsList(updatedList);
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedList));
    } catch {
      // Bỏ qua lỗi quota
    }
  };

  const handleSelectIcon = (spec: StructuredIconSpec) => {
    setSelectedIconId(spec.id);
    setIconSpec({ ...spec });
  };

  const handleUpdateCurrentSpec = (updates: Partial<StructuredIconSpec>) => {
    const updated = { ...iconSpec, ...updates };
    setIconSpec(updated);
    const updatedList = iconsList.map((item) => (item.id === updated.id ? updated : item));
    saveToStorage(updatedList);
  };

  const handleResetToPreset = () => {
    const preset = SVNDTS_ICON_PRESETS.find((p) => p.id === iconSpec.id);
    if (preset) {
      setIconSpec({ ...preset });
      const updatedList = iconsList.map((item) => (item.id === preset.id ? { ...preset } : item));
      saveToStorage(updatedList);
    }
  };

  const handleCreateNewIcon = ({ name, description }: { name: string; description: string }) => {
    const newId = `custom-${Date.now()}`;
    const newSpec: StructuredIconSpec = {
      id: newId,
      name,
      category: 'custom',
      description: description || 'Icon tùy biến mới cho hệ thống SVNDTS',
      viewBoxSize: 24,
      containerShape: 'squircle',
      containerFill: 'none',
      strokeWidth: 1.75,
      colorTone: 'sapphire',
      cornerRadius: 4,
      accentDot: false,
      glyphPath: BUILTIN_GLYPHS[0].path,
      isCustom: true,
    };

    const nextList = [...iconsList, newSpec];
    saveToStorage(nextList);
    setSelectedIconId(newId);
    setIconSpec(newSpec);
    setIsCreatingNew(false);
  };

  const handleDeleteCustomIcon = (idToDelete: string) => {
    const nextList = iconsList.filter((item) => item.id !== idToDelete);
    saveToStorage(nextList);
    if (selectedIconId === idToDelete) {
      const fallback = nextList[0] ?? SVNDTS_ICON_PRESETS[0];
      setSelectedIconId(fallback.id);
      setIconSpec({ ...fallback });
    }
  };

  const handleExportJsonLibrary = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(iconsList, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute('href', dataStr);
    dlAnchorElem.setAttribute('download', 'svndts-brand-icons.json');
    dlAnchorElem.click();
  };

  const handleImportJsonLibrary = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const { icons, skipped } = parseIconLibrary(String(event.target?.result ?? ''));
        if (icons.length === 0) {
          setLibraryMessage('File không có icon hợp lệ nào, thư viện hiện tại được giữ nguyên.');
          return;
        }
        const merged = mergeWithPresets(icons);
        saveToStorage(merged);
        setSelectedIconId(merged[0].id);
        setIconSpec({ ...merged[0] });
        setLibraryMessage(
          skipped > 0
            ? `Đã nạp ${icons.length} icon, bỏ qua ${skipped} mục sai định dạng hoặc trùng mã.`
            : `Đã nạp ${icons.length} icon.`,
        );
      } catch (error) {
        setLibraryMessage(error instanceof Error ? error.message : 'Không đọc được file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Dán nguyên mã SVG (vd. "Copy SVG" từ Lucide) thì tự chuyển thành chuỗi path thay vì dán thô vào ô
  const handlePathPaste = (field: 'glyphPath' | 'secondaryPath', event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text');
    if (!looksLikeSvgMarkup(text)) {
      setPathImportNote(null);
      return;
    }
    event.preventDefault();
    try {
      const result = svgMarkupToPathData(text);
      handleUpdateCurrentSpec({ [field]: result.path });
      setPathImportNote({
        field,
        tone: 'ok',
        messages: [`Đã chuyển ${result.elementCount} hình nét từ SVG thành một chuỗi path.`, ...result.warnings],
      });
    } catch (error) {
      setPathImportNote({
        field,
        tone: 'error',
        messages: [error instanceof Error ? error.message : 'Không đọc được mã SVG.'],
      });
    }
  };

  const renderPathImportNote = (field: 'glyphPath' | 'secondaryPath') =>
    pathImportNote && pathImportNote.field === field ? (
      <ul
        className={`space-y-0.5 text-[11px] ${pathImportNote.tone === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}
        role={pathImportNote.tone === 'ok' ? 'status' : 'alert'}
      >
        {pathImportNote.messages.map((message, index) => (
          <li className={index > 0 ? 'text-amber-700' : undefined} key={message}>
            {message}
          </li>
        ))}
      </ul>
    ) : null;

  const colorDef = BRAND_COLORS[iconSpec.colorTone] ?? BRAND_COLORS.sapphire;
  const glyphScale = resolveGlyphScale(iconSpec);
  const glyphPathValid = isValidPathData(iconSpec.glyphPath);
  const secondaryPathValid = isValidPathData(iconSpec.secondaryPath);

  const cleanSvgCode = useMemo(() => generateCleanSvg(iconSpec, { colorMode }), [iconSpec, colorMode]);
  const reactTsxCode = useMemo(() => generateReactComponent(iconSpec, { colorMode }), [iconSpec, colorMode]);

  const handleCopyCode = async (type: 'svg' | 'tsx') => {
    const textToCopy = type === 'svg' ? cleanSvgCode : reactTsxCode;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    }
  };

  const handleDownload = () => {
    downloadSvgFile(`svndts-${iconSpec.id}`, cleanSvgCode);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Tiêu đề trang và thao tác nhanh nằm cùng một hàng, ngăn cách bằng đường kẻ nhẹ */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">SVNDTS Brand Icon Studio</h1>
            <Badge className="border-blue-200 bg-blue-50 font-medium text-blue-700" variant="outline">
              Lưới 24x24 Chuẩn Hóa
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Thiết kế, tùy biến và chuẩn hoá bộ nhận diện thương hiệu độc quyền cho nền tảng SVNDTS và các phân hệ doanh
            nghiệp.
          </p>
        </div>

        <div aria-hidden="true" className="hidden h-10 w-px shrink-0 bg-slate-200 lg:block" />

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            className="rounded border-blue-600 bg-blue-600 px-3 text-white shadow-xs hover:bg-blue-700"
            onClick={() => setIsCreatingNew(true)}
          >
            <Plus className="size-4" />
            Tạo icon mới
          </Button>

          <Button
            className="rounded border-slate-200 bg-white px-3 text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900"
            onClick={handleExportJsonLibrary}
            variant="outline"
          >
            <FileJson className="size-4" />
            Sao lưu JSON
          </Button>

          <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-xs transition-colors hover:bg-slate-50 hover:text-slate-900">
            <Upload className="size-4" />
            <span>Nạp JSON</span>
            <input accept=".json" className="hidden" onChange={handleImportJsonLibrary} type="file" />
          </label>

          <Button
            className="rounded border-slate-200 bg-white px-3 text-blue-700 shadow-xs hover:bg-blue-50 hover:text-blue-800"
            onClick={handleDownload}
            variant="outline"
          >
            <Download className="size-4" />
            Tải SVG
          </Button>

          {!iconSpec.isCustom ? (
            <Popconfirm
              cancelText="Hủy"
              description="Các chỉnh sửa trên icon này sẽ trở về thông số chuẩn ban đầu."
              okText="Đặt lại"
              onConfirm={handleResetToPreset}
              title="Đặt lại thông số gốc?"
            >
              <Button className="rounded px-3 text-slate-600 hover:bg-slate-100 hover:text-slate-900" variant="ghost">
                <RotateCcw className="size-4" />
                Đặt lại
              </Button>
            </Popconfirm>
          ) : (
            <Popconfirm
              cancelText="Hủy"
              description="Bạn có chắc chắn muốn xóa icon tùy biến này khỏi danh sách?"
              okText="Xóa vĩnh viễn"
              onConfirm={() => handleDeleteCustomIcon(iconSpec.id)}
              title="Xóa icon tùy biến?"
            >
              <Button className="rounded px-3 text-red-600 hover:bg-red-50 hover:text-red-700" variant="ghost">
                <Trash2 className="size-4" />
                Xóa icon
              </Button>
            </Popconfirm>
          )}
        </div>
      </header>

      {libraryMessage ? (
        <div
          className="flex items-center justify-between gap-3 rounded border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-900"
          role="status"
        >
          <span>{libraryMessage}</span>
          <button
            className="shrink-0 font-semibold text-blue-700 hover:underline"
            onClick={() => setLibraryMessage(null)}
            type="button"
          >
            Đóng
          </button>
        </div>
      ) : null}

      <NewIconDialog
        isOpen={isCreatingNew}
        onClose={() => setIsCreatingNew(false)}
        onCreate={handleCreateNewIcon}
      />

      {/* Bố cục 3 cột phẳng: chỉ kẻ đường dọc giữa các cột, không dùng thẻ bao ngoài */}
      <div className="grid grid-cols-1 gap-y-10 lg:grid-cols-12 lg:gap-y-0 lg:divide-x lg:divide-slate-200">
        {/* CỘT 1: Danh mục biểu tượng */}
        <section className="min-w-0 lg:col-span-3 lg:pr-6">
          <PanelTitle aside={`${iconsList.length} icon`} title="Danh mục biểu tượng" />
          <ul className="mt-1 max-h-[calc(100vh-260px)] divide-y divide-slate-200/70 overflow-y-auto pr-1">
            {iconsList.map((preset) => {
              const isSelected = preset.id === selectedIconId;
              const presetColor = BRAND_COLORS[preset.colorTone] ?? BRAND_COLORS.sapphire;
              return (
                <li key={preset.id}>
                  <button
                    className={`flex w-full items-center gap-3 border-l-2 px-2.5 py-2.5 text-left transition-colors ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/80'
                        : 'border-transparent hover:bg-slate-100/70'
                    }`}
                    onClick={() => handleSelectIcon(preset)}
                    type="button"
                  >
                    <span
                      className="flex size-9 shrink-0 items-center justify-center rounded"
                      style={{ backgroundColor: presetColor.bgSoft }}
                    >
                      <BrandIconSvg className="size-5" colorMode="brand" spec={preset} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-1">
                        <span className="truncate text-xs font-semibold text-slate-900">{preset.name}</span>
                        {preset.isCustom ? (
                          <span className="shrink-0 rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-800">
                            Tùy biến
                          </span>
                        ) : (
                          <span className="shrink-0 text-[10px] text-slate-400">{preset.category}</span>
                        )}
                      </span>
                      <span className="line-clamp-1 text-[11px] text-slate-500">{preset.description}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* CỘT 2: Canvas và bảng tuỳ biến */}
        <div className="min-w-0 space-y-8 lg:col-span-5 lg:px-6">
          <section>
            <PanelTitle
              aside={
                <Button
                  className="size-7 rounded p-0 text-slate-500 hover:bg-slate-200/60 hover:text-slate-900"
                  onClick={() => setShowGrid(!showGrid)}
                  size="sm"
                  title="Bật/Tắt lưới pixel"
                  variant="ghost"
                >
                  <Grid className={`size-4 ${showGrid ? 'text-blue-600' : 'text-slate-400'}`} />
                </Button>
              }
              icon={Palette}
              title={iconSpec.name}
            />
            <div className="mt-4 flex flex-col items-center">
              {/* Vùng canvas là mặt làm việc của công cụ nên giữ khung */}
              <div className="relative flex size-60 items-center justify-center rounded-md border border-slate-200 bg-white p-4">
                {showGrid ? (
                  <svg
                    className="pointer-events-none absolute inset-0 size-full stroke-slate-300/60"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <defs>
                      <pattern height="1" id="grid-pattern-light" patternUnits="userSpaceOnUse" width="1">
                        <path d="M 1 0 L 0 0 0 1" fill="none" strokeWidth="0.05" />
                      </pattern>
                    </defs>
                    <rect fill="url(#grid-pattern-light)" height="24" width="24" />
                  </svg>
                ) : null}

                {/* SVG Render chính: dùng chung cây phần tử với bộ xuất mã */}
                <BrandIconSvg
                  className="relative z-10 size-44 transition-all"
                  colorMode={colorMode}
                  spec={iconSpec}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span>Lưới chuẩn: <strong>24x24 px</strong></span>
                <span>•</span>
                <span>Nét: <strong>{iconSpec.strokeWidth}px</strong></span>
                <span>•</span>
                <span>Bo góc: <strong>{iconSpec.cornerRadius}px</strong></span>
                <span>•</span>
                <span>Hình lõi: <strong>{Math.round(glyphScale * 100)}%</strong></span>
              </div>
            </div>
          </section>

          {/* Bảng tuỳ biến: thanh tab gạch chân thay cho thẻ có tiêu đề */}
          <section>
            <div className="flex items-center gap-1 border-b border-slate-200">
              <Sliders className="mr-1 size-4 text-blue-600" />
              {(
                [
                  { id: 'style', label: 'Kiểu dáng & Màu' },
                  { id: 'glyph', label: 'Thư viện Nét' },
                  { id: 'custom-path', label: 'Nhập Mã SVG Path' },
                ] as const
              ).map((tab) => (
                <button
                  className={`-mb-px border-b-2 px-2.5 py-2 text-xs font-semibold transition-colors ${
                    activeInspectorTab === tab.id
                      ? 'border-blue-600 text-blue-700'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                  key={tab.id}
                  onClick={() => setActiveInspectorTab(tab.id)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="space-y-4 pt-4 text-xs">
              {/* TAB 1: STYLE & COLOR */}
              {activeInspectorTab === 'style' ? (
                <div className="space-y-4">
                  {/* Chọn Khung Hình Học */}
                  <div className="space-y-2">
                    <label className="font-semibold text-slate-700">Khung chứa hình học (Container Shape):</label>
                    <div className="grid grid-cols-3 gap-2">
                      {SHAPE_OPTIONS.map(({ id, label, icon: IconComp }) => {
                        const isShapeSelected = iconSpec.containerShape === id;
                        return (
                          <button
                            className={`flex items-center gap-1.5 rounded border px-2.5 py-2 text-xs font-medium transition-all ${
                              isShapeSelected
                                ? 'border-blue-600 bg-blue-50 text-blue-800'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                            key={id}
                            onClick={() => handleUpdateCurrentSpec({ containerShape: id })}
                            type="button"
                          >
                            <IconComp className="size-3.5" />
                            <span className="truncate">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Kiểu nền (Fill Mode) */}
                  <div className="space-y-2">
                    <label className="font-semibold text-slate-700">Kiểu nền (Background Fill):</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['none', 'solid', 'gradient'] as ContainerFill[]).map((fill) => {
                        const isFillSelected = iconSpec.containerFill === fill;
                        const labels: Record<ContainerFill, string> = {
                          none: 'Trong suốt',
                          solid: 'Đơn sắc nhạt',
                          gradient: 'Gradient thương hiệu',
                        };
                        return (
                          <button
                            className={`rounded border px-2.5 py-2 text-center text-xs font-medium transition-all ${
                              isFillSelected
                                ? 'border-blue-600 bg-blue-50 text-blue-800'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                            key={fill}
                            onClick={() => handleUpdateCurrentSpec({ containerFill: fill })}
                            type="button"
                          >
                            {labels[fill]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Chọn Màu Nhận diện */}
                  <div className="space-y-2">
                    <label className="font-semibold text-slate-700">Bảng màu chuẩn hóa SVNDTS:</label>
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(BRAND_COLORS) as BrandColorKey[]).map((colorKey) => {
                        const c = BRAND_COLORS[colorKey];
                        const isColorSelected = iconSpec.colorTone === colorKey;
                        return (
                          <button
                            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                              isColorSelected
                                ? 'border-slate-900 bg-slate-900 text-white'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                            key={colorKey}
                            onClick={() => handleUpdateCurrentSpec({ colorTone: colorKey })}
                            type="button"
                          >
                            <span className="size-2.5 rounded-full" style={{ backgroundColor: c.primary }} />
                            <span>{c.name.split(' ')[0]} {c.name.split(' ')[1]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Độ dày nét & Bo góc */}
                  <div className="grid grid-cols-2 gap-4 pt-1">
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-slate-700">
                        <span className="font-medium">Độ dày nét:</span>
                        <strong className="text-blue-600">{iconSpec.strokeWidth} px</strong>
                      </div>
                      <input
                        className="w-full accent-blue-600"
                        max="3.0"
                        min="1.0"
                        onChange={(e) => handleUpdateCurrentSpec({ strokeWidth: parseFloat(e.target.value) })}
                        step="0.25"
                        type="range"
                        value={iconSpec.strokeWidth}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-slate-700">
                        <span className="font-medium">Bo góc:</span>
                        <strong className="text-blue-600">{iconSpec.cornerRadius} px</strong>
                      </div>
                      <input
                        className="w-full accent-blue-600"
                        max="8"
                        min="2"
                        onChange={(e) => handleUpdateCurrentSpec({ cornerRadius: parseInt(e.target.value, 10) })}
                        step="1"
                        type="range"
                        value={iconSpec.cornerRadius}
                      />
                    </div>

                    <div className="col-span-2 space-y-1.5">
                      <div className="flex justify-between text-slate-700">
                        <span className="font-medium">
                          Tỷ lệ hình lõi trong khung:
                          {iconSpec.glyphScale === undefined ? <span className="ml-1 text-slate-400">(tự động)</span> : null}
                        </span>
                        <span className="flex items-center gap-2">
                          <strong className="text-blue-600">{Math.round(glyphScale * 100)}%</strong>
                          {iconSpec.glyphScale !== undefined ? (
                            <button
                              className="font-medium text-blue-700 hover:underline"
                              onClick={() => handleUpdateCurrentSpec({ glyphScale: undefined })}
                              type="button"
                            >
                              Tự động
                            </button>
                          ) : null}
                        </span>
                      </div>
                      <input
                        className="w-full accent-blue-600"
                        max="1.1"
                        min="0.5"
                        onChange={(e) => handleUpdateCurrentSpec({ glyphScale: parseFloat(e.target.value) })}
                        step="0.05"
                        type="range"
                        value={glyphScale}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {/* TAB 2: GLYPH LIBRARY (Thư viện nét vẽ có sẵn) */}
              {activeInspectorTab === 'glyph' ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">
                    Bấm vào một nét vẽ bên dưới để áp dụng trực tiếp cho icon đang chọn:
                  </p>
                  <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
                    {BUILTIN_GLYPHS.map((g) => {
                      const isGlyphActive = iconSpec.glyphPath === g.path;
                      return (
                        <button
                          className={`flex items-center gap-2.5 rounded border p-2 text-left transition-all ${
                            isGlyphActive
                              ? 'border-blue-600 bg-blue-50 text-blue-900'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                          key={g.id}
                          onClick={() => handleUpdateCurrentSpec({ glyphPath: g.path })}
                          type="button"
                        >
                          <svg
                            className="size-6 shrink-0"
                            fill="none"
                            stroke={colorDef.primary}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.75"
                            viewBox="0 0 24 24"
                          >
                            <path d={g.path} />
                          </svg>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-slate-800">{g.name}</p>
                            <span className="text-[10px] text-slate-400">{g.group}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* TAB 3: CUSTOM SVG PATH (Dán mã SVG vẽ từ bên ngoài) */}
              {activeInspectorTab === 'custom-path' ? (
                <div className="space-y-3">
                  <div className="rounded border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                    <strong>Dán thẳng mã SVG:</strong> với Lucide, Figma, GodSVG hay bất kỳ thư viện icon nào, bấm &quot;Copy SVG&quot; rồi dán nguyên đoạn <code>&lt;svg&gt;...&lt;/svg&gt;</code> vào ô bên dưới, Studio tự gộp các hình (path, circle, rect, line...) thành một chuỗi path. Bạn vẫn có thể dán riêng chuỗi <code>d=&quot;...&quot;</code>.
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Chuỗi tọa độ nét chính (Main Glyph Path `d`):</label>
                    <textarea
                      className="w-full rounded border border-slate-300 bg-white p-2 font-mono text-[11px] text-slate-800 focus:border-blue-500 focus:outline-none"
                      onChange={(e) => {
                        setPathImportNote(null);
                        handleUpdateCurrentSpec({ glyphPath: e.target.value });
                      }}
                      onPaste={(e) => handlePathPaste('glyphPath', e)}
                      rows={4}
                      value={iconSpec.glyphPath}
                    />
                    {renderPathImportNote('glyphPath')}
                    {!glyphPathValid ? (
                      <p className="text-[11px] text-red-600" role="alert">
                        Chuỗi path không hợp lệ (phải bắt đầu bằng M và chỉ gồm lệnh, số, dấu cách, dấu phẩy). Nét này chưa được hiển thị hay xuất ra.
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Chuỗi tọa độ nét phụ (Secondary Path `d` - Tùy chọn):</label>
                    <textarea
                      className="w-full rounded border border-slate-300 bg-white p-2 font-mono text-[11px] text-slate-800 focus:border-blue-500 focus:outline-none"
                      onChange={(e) => {
                        setPathImportNote(null);
                        handleUpdateCurrentSpec({ secondaryPath: e.target.value });
                      }}
                      onPaste={(e) => handlePathPaste('secondaryPath', e)}
                      placeholder="Nhập nét phụ mờ (nếu có)..."
                      rows={2}
                      value={iconSpec.secondaryPath ?? ''}
                    />
                    {renderPathImportNote('secondaryPath')}
                    {!secondaryPathValid ? (
                      <p className="text-[11px] text-red-600" role="alert">
                        Chuỗi path không hợp lệ. Nét phụ chưa được hiển thị hay xuất ra.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        {/* CỘT 3: Xem trước và xuất mã */}
        <div className="min-w-0 space-y-8 lg:col-span-4 lg:pl-6">
          <section>
            <PanelTitle icon={Eye} title="Xem trước thực tế (Live Preview)" />
            <div className="mt-4 space-y-4">
              {/* Các khung nhỏ dưới đây mô phỏng giao diện thật nên giữ viền */}
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-500">1. Tab trình duyệt (Favicon 16px):</span>
                <div className="flex items-center gap-2 rounded-t-md border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs text-slate-700">
                  <BrandIconSvg className="size-4 shrink-0" colorMode="brand" spec={iconSpec} />
                  <span className="truncate font-medium text-slate-800">SVNDTS Enterprise Platform</span>
                  <span className="ml-auto text-slate-400">✕</span>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-500">2. Mục điều hướng thanh bên sáng (Sidebar 20px):</span>
                <div className="flex items-center gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                  <BrandIconSvg className="size-5 shrink-0" colorMode="brand" spec={iconSpec} />
                  <span className="font-medium text-slate-900">{iconSpec.name}</span>
                  <span className="ml-auto rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">Kích hoạt</span>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-500">3. Thẻ phân hệ bảng điều khiển (Module Card):</span>
                <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white p-3">
                  <div
                    className="flex size-10 shrink-0 items-center justify-center rounded"
                    style={{ backgroundColor: colorDef.bgSoft }}
                  >
                    <BrandIconSvg className="size-6" colorMode="brand" spec={iconSpec} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-slate-900">{iconSpec.name}</h4>
                    <p className="line-clamp-1 text-[11px] text-slate-500">{iconSpec.description}</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <PanelTitle
              aside={
                <div className="flex rounded border border-slate-200 bg-slate-100 p-0.5">
                  {(
                    [
                      { id: 'svg', label: 'Clean SVG' },
                      { id: 'tsx', label: 'React TSX' },
                    ] as const
                  ).map((tab) => (
                    <button
                      className={`rounded-sm px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        activeCodeTab === tab.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'
                      }`}
                      key={tab.id}
                      onClick={() => setActiveCodeTab(tab.id)}
                      type="button"
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              }
              icon={Code2}
              title="Bộ xuất mã sạch"
            />
            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-slate-500">Màu khi xuất:</span>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: 'currentColor', label: 'Theo ngữ cảnh', hint: 'currentColor, đổi theo chữ xung quanh' },
                      { id: 'brand', label: 'Cố định màu SVNDTS', hint: 'Ghi cứng mã màu, cho file độc lập' },
                    ] as const
                  ).map((option) => (
                    <button
                      className={`rounded border px-2.5 py-1.5 text-left transition-colors ${
                        colorMode === option.id
                          ? 'border-blue-600 bg-blue-50 text-blue-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                      key={option.id}
                      onClick={() => setColorMode(option.id)}
                      type="button"
                    >
                      <span className="block text-xs font-semibold">{option.label}</span>
                      <span className="block text-[10px] text-slate-500">{option.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <pre className="max-h-48 overflow-auto rounded-md bg-[#091426] p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                {activeCodeTab === 'svg' ? cleanSvgCode : reactTsxCode}
              </pre>

              <Button
                className="w-full rounded bg-blue-600 text-white hover:bg-blue-700"
                onClick={() => handleCopyCode(activeCodeTab)}
              >
                {copiedType === activeCodeTab ? (
                  <>
                    <Check className="size-4 text-emerald-300" />
                    Đã sao chép!
                  </>
                ) : (
                  <>
                    <Copy className="size-4" />
                    Sao chép {activeCodeTab === 'svg' ? 'mã SVG' : 'component TSX'}
                  </>
                )}
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function PanelTitle({
  title,
  icon: Icon,
  aside,
}: {
  title: string;
  icon?: typeof Palette;
  aside?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-2 border-b border-slate-200 pb-2">
      <div className="flex min-w-0 items-center gap-2">
        {Icon ? <Icon className="size-4 shrink-0 text-blue-600" /> : null}
        <h2 className="truncate text-xs font-semibold uppercase tracking-wider text-slate-600">{title}</h2>
      </div>
      {typeof aside === 'string' ? <span className="shrink-0 text-[11px] text-slate-500">{aside}</span> : aside}
    </div>
  );
}
