'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import {
  BRAND_COLORS,
  BUILTIN_GLYPHS,
  SVNDTS_ICON_PRESETS,
  type BrandColorKey,
  type ContainerFill,
  type ContainerShape,
  type StructuredIconSpec,
} from './brand-icon.types';
import {
  downloadSvgFile,
  generateCleanSvg,
  generateReactComponent,
  getContainerPath,
} from './brand-icon-generator';

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
  const [newIconName, setNewIconName] = useState<string>('');
  const [newIconDesc, setNewIconDesc] = useState<string>('');

  // Tải danh sách icon từ LocalStorage khi khởi tạo
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as StructuredIconSpec[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setIconsList(parsed);
          setSelectedIconId(parsed[0].id);
          setIconSpec({ ...parsed[0] });
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

  const handleCreateNewIcon = () => {
    if (!newIconName.trim()) return;
    const newId = `custom-${Date.now()}`;
    const newSpec: StructuredIconSpec = {
      id: newId,
      name: newIconName.trim(),
      category: 'custom',
      description: newIconDesc.trim() || 'Icon tùy biến mới cho hệ thống SVNDTS',
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
    setNewIconName('');
    setNewIconDesc('');
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
        const parsed = JSON.parse(event.target?.result as string);
        if (Array.isArray(parsed) && parsed.length > 0) {
          saveToStorage(parsed);
          setSelectedIconId(parsed[0].id);
          setIconSpec({ ...parsed[0] });
        }
      } catch {
        alert('File JSON không hợp lệ.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const colorDef = BRAND_COLORS[iconSpec.colorTone] ?? BRAND_COLORS.sapphire;
  const containerPath = getContainerPath(iconSpec.containerShape, iconSpec.viewBoxSize, iconSpec.cornerRadius);

  const cleanSvgCode = useMemo(() => generateCleanSvg(iconSpec), [iconSpec]);
  const reactTsxCode = useMemo(() => generateReactComponent(iconSpec), [iconSpec]);

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
      {/* Thanh tiêu đề thao tác nhanh - Giao diện sáng chuẩn Enterprise */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white px-5 py-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600">
            <Sparkles className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">SVNDTS Structured SVG Studio</h2>
              <Badge className="border-blue-200 bg-blue-50 font-medium text-blue-700" variant="outline">
                Lưới 24x24 Chuẩn Hóa
              </Badge>
            </div>
            <p className="text-xs text-slate-500">
              Công cụ tạo mới, tùy biến và chuẩn hoá bộ nhận diện thương hiệu độc quyền cho nền tảng SVNDTS
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Nút Tạo Icon Mới */}
          <Button
            className="border-blue-600 bg-blue-600 text-white hover:bg-blue-700 shadow-xs"
            onClick={() => setIsCreatingNew(true)}
            size="sm"
          >
            <Plus className="mr-1.5 size-3.5" />
            Tạo Icon Mới
          </Button>

          {/* Xuất / Nhập JSON Library */}
          <Button
            className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 shadow-xs"
            onClick={handleExportJsonLibrary}
            size="sm"
            variant="outline"
          >
            <FileJson className="mr-1.5 size-3.5" />
            Sao lưu JSON
          </Button>

          <label className="inline-flex cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900">
            <Upload className="mr-1.5 size-3.5" />
            <span>Nạp JSON</span>
            <input accept=".json" className="hidden" onChange={handleImportJsonLibrary} type="file" />
          </label>

          {/* Tải SVG */}
          <Button
            className="border-slate-200 bg-white text-blue-700 hover:bg-blue-50 hover:text-blue-800 shadow-xs"
            onClick={handleDownload}
            size="sm"
            variant="outline"
          >
            <Download className="mr-1.5 size-3.5" />
            Tải SVG
          </Button>

          {/* Đặt lại nếu là preset */}
          {!iconSpec.isCustom ? (
            <Popconfirm
              cancelText="Hủy"
              description="Các chỉnh sửa trên icon này sẽ trở về thông số chuẩn ban đầu."
              okText="Đặt lại"
              onConfirm={handleResetToPreset}
              title="Đặt lại thông số gốc?"
            >
              <Button className="border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900" size="sm" variant="ghost">
                <RotateCcw className="mr-1.5 size-3.5" />
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
              <Button className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" size="sm" variant="ghost">
                <Trash2 className="mr-1.5 size-3.5" />
                Xóa icon
              </Button>
            </Popconfirm>
          )}
        </div>
      </div>

      {/* Form Tạo Mới Icon (Hiển thị khi bấm Tạo Icon Mới) */}
      {isCreatingNew ? (
        <Card className="border-blue-200 bg-blue-50/50 shadow-xs">
          <CardHeader className="border-b border-blue-100 px-4 py-3">
            <CardTitle className="text-sm font-semibold text-blue-950">
              Khởi tạo Biểu tượng Mới vào Hệ sinh thái SVNDTS
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Tên biểu tượng (VD: Đơn hàng, Quản lý xe, Hợp đồng...):</label>
                <input
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none"
                  onChange={(e) => setNewIconName(e.target.value)}
                  placeholder="Nhập tên icon..."
                  value={newIconName}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Mô tả mục đích sử dụng:</label>
                <input
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none"
                  onChange={(e) => setNewIconDesc(e.target.value)}
                  placeholder="Nhập mô tả ngắn gọn..."
                  value={newIconDesc}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button onClick={() => setIsCreatingNew(false)} size="sm" variant="ghost">
                Hủy bỏ
              </Button>
              <Button
                className="bg-blue-600 text-white hover:bg-blue-700"
                disabled={!newIconName.trim()}
                onClick={handleCreateNewIcon}
                size="sm"
              >
                Xác nhận tạo
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Bố cục 16:9 Master-Detail 3 Cột - Theme Sáng */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* CỘT 1: MASTER (3 cột / 12) - Danh mục Biểu tượng */}
        <div className="space-y-4 lg:col-span-3">
          <Card className="border-slate-200/90 bg-white shadow-xs">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Danh mục Biểu tượng
                </CardTitle>
                <Badge className="bg-slate-200/80 font-medium text-[10px] text-slate-700" variant="secondary">
                  {iconsList.length} Icon
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 p-2.5">
              <div className="max-h-[calc(100vh-290px)] space-y-1.5 overflow-y-auto pr-1">
                {iconsList.map((preset) => {
                  const isSelected = preset.id === selectedIconId;
                  const presetColor = BRAND_COLORS[preset.colorTone] ?? BRAND_COLORS.sapphire;
                  return (
                    <button
                      className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-all ${
                        isSelected
                          ? 'border-blue-600 bg-blue-50/90 text-blue-950 shadow-xs ring-1 ring-blue-500/20'
                          : 'border-slate-200/80 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                      key={preset.id}
                      onClick={() => handleSelectIcon(preset)}
                      type="button"
                    >
                      <div
                        className="flex size-9 shrink-0 items-center justify-center rounded-md border"
                        style={{
                          borderColor: presetColor.border,
                          backgroundColor: presetColor.bgSoft,
                        }}
                      >
                        <svg
                          className="size-5"
                          fill="none"
                          stroke={presetColor.primary}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={preset.strokeWidth}
                          viewBox={`0 0 ${preset.viewBoxSize} ${preset.viewBoxSize}`}
                        >
                          {preset.containerShape !== 'none' ? (
                            <path d={getContainerPath(preset.containerShape, preset.viewBoxSize, preset.cornerRadius)} />
                          ) : null}
                          <path d={preset.glyphPath} />
                        </svg>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className="truncate text-xs font-semibold text-slate-900">{preset.name}</p>
                          {preset.isCustom ? (
                            <span className="shrink-0 rounded bg-amber-100 px-1 py-0.2 text-[9px] font-medium text-amber-800">
                              Tùy biến
                            </span>
                          ) : (
                            <span className="shrink-0 text-[10px] text-slate-400">{preset.category}</span>
                          )}
                        </div>
                        <p className="line-clamp-1 text-[11px] text-slate-500">{preset.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* CỘT 2: DETAIL CANVAS & INSPECTOR (5 cột / 12) - Thiết kế Trực quan */}
        <div className="space-y-4 lg:col-span-5">
          {/* Canvas vẽ SVG tương tác */}
          <Card className="border-slate-200/90 bg-white shadow-xs">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Palette className="size-4 text-blue-600" />
                  <CardTitle className="text-sm font-semibold text-slate-900">
                    {iconSpec.name}
                  </CardTitle>
                </div>
                <Button
                  className="size-7 p-0 text-slate-500 hover:bg-slate-200/60 hover:text-slate-900"
                  onClick={() => setShowGrid(!showGrid)}
                  size="sm"
                  title="Bật/Tắt Lưới Pixel"
                  variant="ghost"
                >
                  <Grid className={`size-4 ${showGrid ? 'text-blue-600' : 'text-slate-400'}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center p-6">
              {/* Vùng Canvas SVG phóng to 240x240 - Nền sáng */}
              <div className="relative flex size-60 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-inner">
                {/* Lưới tọa độ 24x24 */}
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

                {/* SVG Render chính */}
                <svg
                  className="relative z-10 size-44 drop-shadow-sm transition-all"
                  fill="none"
                  viewBox={`0 0 ${iconSpec.viewBoxSize} ${iconSpec.viewBoxSize}`}
                >
                  {iconSpec.containerFill === 'gradient' ? (
                    <defs>
                      <linearGradient id="canvas-gradient-light" x1="0%" x2="100%" y1="0%" y2="100%">
                        <stop offset="0%" stopColor={colorDef.primary} stopOpacity="0.25" />
                        <stop offset="100%" stopColor={colorDef.secondary} stopOpacity="0.05" />
                      </linearGradient>
                    </defs>
                  ) : null}

                  {/* Khung chứa */}
                  {containerPath ? (
                    <path
                      d={containerPath}
                      fill={
                        iconSpec.containerFill === 'solid'
                          ? colorDef.bgSoft
                          : iconSpec.containerFill === 'gradient'
                          ? 'url(#canvas-gradient-light)'
                          : 'none'
                      }
                      stroke={colorDef.primary}
                      strokeLinejoin="round"
                      strokeWidth={iconSpec.strokeWidth}
                    />
                  ) : null}

                  {/* Nét vẽ lõi */}
                  <path
                    d={iconSpec.glyphPath}
                    stroke={colorDef.primary}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={iconSpec.strokeWidth}
                  />

                  {/* Nét phụ nếu có */}
                  {iconSpec.secondaryPath ? (
                    <path
                      d={iconSpec.secondaryPath}
                      opacity="0.6"
                      stroke={colorDef.border}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={iconSpec.strokeWidth}
                    />
                  ) : null}

                  {/* Điểm nhấn thương hiệu */}
                  {iconSpec.accentDot ? (
                    <circle cx={iconSpec.viewBoxSize - 3.5} cy="3.5" fill={colorDef.primary} r="1.5" />
                  ) : null}
                </svg>
              </div>

              <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
                <span>Lưới chuẩn: <strong>24x24 px</strong></span>
                <span>•</span>
                <span>Nét: <strong>{iconSpec.strokeWidth}px</strong></span>
                <span>•</span>
                <span>Bo góc: <strong>{iconSpec.cornerRadius}px</strong></span>
              </div>
            </CardContent>
          </Card>

          {/* Bảng điều khiển tham số (Inspector) - Chia 3 Tab: Style / Thư viện Nét / Tùy biến Path */}
          <Card className="border-slate-200/90 bg-white shadow-xs">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="size-4 text-blue-600" />
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Bảng Tùy Biến
                  </CardTitle>
                </div>

                <div className="flex rounded-md border border-slate-200 bg-slate-100 p-0.5">
                  <button
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      activeInspectorTab === 'style'
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    onClick={() => setActiveInspectorTab('style')}
                    type="button"
                  >
                    Kiểu dáng & Màu
                  </button>
                  <button
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      activeInspectorTab === 'glyph'
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    onClick={() => setActiveInspectorTab('glyph')}
                    type="button"
                  >
                    Thư viện Nét
                  </button>
                  <button
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      activeInspectorTab === 'custom-path'
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    onClick={() => setActiveInspectorTab('custom-path')}
                    type="button"
                  >
                    Nhập Mã SVG Path
                  </button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 p-4 text-xs">
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
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-all ${
                              isShapeSelected
                                ? 'border-blue-600 bg-blue-50 text-blue-800 shadow-xs ring-1 ring-blue-500/20'
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
                            className={`rounded-lg border px-2.5 py-2 text-center text-xs font-medium transition-all ${
                              isFillSelected
                                ? 'border-blue-600 bg-blue-50 text-blue-800 shadow-xs ring-1 ring-blue-500/20'
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
                                ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
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
                          className={`flex items-center gap-2.5 rounded-lg border p-2 text-left transition-all ${
                            isGlyphActive
                              ? 'border-blue-600 bg-blue-50 text-blue-900 shadow-xs ring-1 ring-blue-500/20'
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
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                    <strong>Hỗ trợ tùy biến không giới hạn:</strong> Bạn có thể vẽ icon từ GodSVG, Figma, Illustrator hoặc sao chép từ bất kỳ thư viện icon nào, sau đó dán chuỗi thuộc tính <code>d="..."</code> vào ô bên dưới.
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Chuỗi tọa độ nét chính (Main Glyph Path `d`):</label>
                    <textarea
                      className="w-full rounded-md border border-slate-300 bg-white p-2 font-mono text-[11px] text-slate-800 shadow-xs focus:border-blue-500 focus:outline-none"
                      onChange={(e) => handleUpdateCurrentSpec({ glyphPath: e.target.value })}
                      rows={4}
                      value={iconSpec.glyphPath}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Chuỗi tọa độ nét phụ (Secondary Path `d` - Tùy chọn):</label>
                    <textarea
                      className="w-full rounded-md border border-slate-300 bg-white p-2 font-mono text-[11px] text-slate-800 shadow-xs focus:border-blue-500 focus:outline-none"
                      onChange={(e) => handleUpdateCurrentSpec({ secondaryPath: e.target.value })}
                      placeholder="Nhập nét phụ mờ (nếu có)..."
                      rows={2}
                      value={iconSpec.secondaryPath ?? ''}
                    />
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* CỘT 3: PREVIEW ĐA NGỮ CẢNH & EXPORT CODE (4 cột / 12) */}
        <div className="space-y-4 lg:col-span-4">
          {/* Xem trước thực tế (Live Mockup) */}
          <Card className="border-slate-200/90 bg-white shadow-xs">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
              <div className="flex items-center gap-2">
                <Eye className="size-4 text-blue-600" />
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Xem Trước Thực Tế (Live Preview)
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {/* Ngữ cảnh 1: Tab Favicon Trình Duyệt */}
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-500">1. Tab Trình Duyệt (Favicon 16px):</span>
                <div className="flex items-center gap-2 rounded-t-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs text-slate-700">
                  <div
                    className="flex size-4 shrink-0 items-center justify-center rounded"
                    style={{ backgroundColor: colorDef.bgSoft }}
                  >
                    <svg
                      className="size-3.5"
                      fill="none"
                      stroke={colorDef.primary}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox={`0 0 ${iconSpec.viewBoxSize} ${iconSpec.viewBoxSize}`}
                    >
                      <path d={iconSpec.glyphPath} />
                    </svg>
                  </div>
                  <span className="truncate font-medium text-slate-800">SVNDTS Enterprise Platform</span>
                  <span className="ml-auto text-slate-400">✕</span>
                </div>
              </div>

              {/* Ngữ cảnh 2: Thanh Sidebar Navigation (Khung tối chuẩn của Platform) */}
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-500">2. Mục Điều Hướng Thanh Bên (Sidebar 20px):</span>
                <div className="flex items-center gap-3 rounded-md bg-[#091426] px-3 py-2 text-xs text-slate-200 shadow-xs">
                  <div className="flex size-5 shrink-0 items-center justify-center">
                    <svg
                      className="size-4"
                      fill="none"
                      stroke={colorDef.primary}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={iconSpec.strokeWidth}
                      viewBox={`0 0 ${iconSpec.viewBoxSize} ${iconSpec.viewBoxSize}`}
                    >
                      {containerPath ? <path d={containerPath} /> : null}
                      <path d={iconSpec.glyphPath} />
                    </svg>
                  </div>
                  <span className="font-medium text-white">{iconSpec.name}</span>
                  <span className="ml-auto rounded bg-blue-600/40 px-1.5 py-0.5 text-[10px] text-blue-200">Kích hoạt</span>
                </div>
              </div>

              {/* Ngữ cảnh 3: Thẻ Phân Hệ (Module Card 32px) */}
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-500">3. Thẻ Phân Hệ Bảng Điều Khiển (Module Card):</span>
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
                  <div
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg border"
                    style={{
                      borderColor: colorDef.border,
                      backgroundColor: colorDef.bgSoft,
                    }}
                  >
                    <svg
                      className="size-6"
                      fill="none"
                      stroke={colorDef.primary}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={iconSpec.strokeWidth}
                      viewBox={`0 0 ${iconSpec.viewBoxSize} ${iconSpec.viewBoxSize}`}
                    >
                      {containerPath ? <path d={containerPath} /> : null}
                      <path d={iconSpec.glyphPath} />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-slate-900">{iconSpec.name}</h4>
                    <p className="line-clamp-1 text-[11px] text-slate-500">{iconSpec.description}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Hộp Xuất Mã Nguồn (Export Engine) */}
          <Card className="border-slate-200/90 bg-white shadow-xs">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Code2 className="size-4 text-blue-600" />
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Bộ Xuất Mã Sạch
                  </CardTitle>
                </div>

                <div className="flex rounded-md border border-slate-200 bg-slate-100 p-0.5">
                  <button
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      activeCodeTab === 'svg' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                    onClick={() => setActiveCodeTab('svg')}
                    type="button"
                  >
                    Clean SVG
                  </button>
                  <button
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      activeCodeTab === 'tsx' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                    onClick={() => setActiveCodeTab('tsx')}
                    type="button"
                  >
                    React TSX
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              <div className="relative">
                <pre className="max-h-48 overflow-x-auto rounded-lg border border-slate-800 bg-[#091426] p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                  {activeCodeTab === 'svg' ? cleanSvgCode : reactTsxCode}
                </pre>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  className="w-full bg-blue-600 text-white hover:bg-blue-700 shadow-xs"
                  onClick={() => handleCopyCode(activeCodeTab)}
                  size="sm"
                >
                  {copiedType === activeCodeTab ? (
                    <>
                      <Check className="mr-1.5 size-3.5 text-emerald-300" />
                      Đã sao chép!
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1.5 size-3.5" />
                      Sao chép {activeCodeTab === 'svg' ? 'Mã SVG' : 'Component TSX'}
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
