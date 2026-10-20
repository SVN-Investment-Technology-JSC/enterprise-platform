'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  Circle,
  Code2,
  Copy,
  Download,
  Eye,
  Grid,
  Hexagon,
  Layers,
  Palette,
  RotateCcw,
  Shield,
  Sliders,
  Sparkles,
  Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import {
  BRAND_COLORS,
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
  { id: 'squircle', label: 'Squircle', icon: Square },
  { id: 'shield', label: 'Khiên bảo mật', icon: Shield },
  { id: 'hexagon', label: 'Lục giác', icon: Hexagon },
  { id: 'circle', label: 'Hình tròn', icon: Circle },
  { id: 'diamond', label: 'Hình thoi', icon: Sparkles },
  { id: 'none', label: 'Không khung', icon: Layers },
];

export function BrandStudioConsole() {
  const [selectedPresetId, setSelectedPresetId] = useState<string>('svndts-master');
  const [iconSpec, setIconSpec] = useState<StructuredIconSpec>({ ...SVNDTS_ICON_PRESETS[0] });
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [activeCodeTab, setActiveCodeTab] = useState<'svg' | 'tsx'>('svg');
  const [copiedType, setCopiedType] = useState<'svg' | 'tsx' | null>(null);

  const selectedPreset = useMemo(() => {
    return SVNDTS_ICON_PRESETS.find((p) => p.id === selectedPresetId) ?? SVNDTS_ICON_PRESETS[0];
  }, [selectedPresetId]);

  const handleSelectPreset = (preset: StructuredIconSpec) => {
    setSelectedPresetId(preset.id);
    setIconSpec({ ...preset });
  };

  const handleResetToPreset = () => {
    setIconSpec({ ...selectedPreset });
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
    <div className="flex flex-col gap-4">
      {/* Thanh tiêu đề & Tác vụ tổng quan */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/90 px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border border-blue-500/30 bg-blue-600/10 text-blue-400">
            <Sparkles className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white">SVNDTS Brand Icon Studio</h2>
              <Badge className="border-blue-500/30 bg-blue-500/10 text-blue-300" variant="outline">
                Structured SVG 24x24
              </Badge>
            </div>
            <p className="text-xs text-slate-400">
              Công cụ thiết kế & chuẩn hoá bộ nhận diện thương hiệu độc quyền cho nền tảng SVNDTS
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Popconfirm
            cancelText="Hủy"
            description="Tất cả các tùy chỉnh đang sửa trên biểu tượng này sẽ được hoàn nguyên về thông số gốc."
            okText="Đồng ý đặt lại"
            onConfirm={handleResetToPreset}
            title="Đặt lại thông số mặc định?"
          >
            <Button className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white" size="sm" variant="outline">
              <RotateCcw className="mr-1.5 size-3.5" />
              Đặt lại mẫu
            </Button>
          </Popconfirm>

          <Button
            className="border-blue-600/50 bg-blue-600/20 text-blue-200 hover:bg-blue-600 hover:text-white"
            onClick={handleDownload}
            size="sm"
            variant="outline"
          >
            <Download className="mr-1.5 size-3.5" />
            Tải file SVG
          </Button>
        </div>
      </div>

      {/* Bố cục 16:9 Master-Detail 3 Cột */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* CỘT 1: MASTER (3 cột / 12) - Danh mục Presets */}
        <div className="space-y-4 lg:col-span-3">
          <Card className="border-slate-800 bg-slate-900/80">
            <CardHeader className="border-b border-slate-800/80 px-4 py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Danh mục Nhận diện
                </CardTitle>
                <Badge className="bg-slate-800 text-[10px] text-slate-300" variant="secondary">
                  {SVNDTS_ICON_PRESETS.length} Biểu tượng
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 p-2">
              <div className="max-h-[calc(100vh-280px)] space-y-1.5 overflow-y-auto pr-1">
                {SVNDTS_ICON_PRESETS.map((preset) => {
                  const isSelected = preset.id === selectedPresetId;
                  const presetColor = BRAND_COLORS[preset.colorTone] ?? BRAND_COLORS.sapphire;
                  return (
                    <button
                      className={`flex w-full items-center gap-3 rounded-md border p-2.5 text-left transition-all ${
                        isSelected
                          ? 'border-blue-500 bg-blue-950/40 text-white shadow-sm'
                          : 'border-slate-800/70 bg-slate-950/30 text-slate-300 hover:border-slate-700 hover:bg-slate-800/50'
                      }`}
                      key={preset.id}
                      onClick={() => handleSelectPreset(preset)}
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
                          <p className="truncate text-xs font-medium text-slate-200">{preset.name}</p>
                          <span className="shrink-0 text-[10px] text-slate-500">{preset.category}</span>
                        </div>
                        <p className="line-clamp-1 text-[11px] text-slate-400">{preset.description}</p>
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
          <Card className="border-slate-800 bg-slate-900/80">
            <CardHeader className="border-b border-slate-800/80 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Palette className="size-4 text-blue-400" />
                  <CardTitle className="text-sm font-semibold text-white">
                    {iconSpec.name}
                  </CardTitle>
                </div>
                <Button
                  className="size-7 p-0 text-slate-400 hover:text-white"
                  onClick={() => setShowGrid(!showGrid)}
                  size="sm"
                  title="Bật/Tắt Lưới Pixel"
                  variant="ghost"
                >
                  <Grid className={`size-4 ${showGrid ? 'text-blue-400' : 'text-slate-600'}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center p-6">
              {/* Vùng Canvas SVG phóng to 240x240 */}
              <div className="relative flex size-60 items-center justify-center rounded-xl border border-slate-800 bg-slate-950/80 p-4 shadow-inner">
                {/* Lưới tọa độ 24x24 */}
                {showGrid ? (
                  <svg
                    className="pointer-events-none absolute inset-0 size-full stroke-slate-800/40"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <defs>
                      <pattern height="1" id="grid-pattern" patternUnits="userSpaceOnUse" width="1">
                        <path d="M 1 0 L 0 0 0 1" fill="none" strokeWidth="0.05" />
                      </pattern>
                    </defs>
                    <rect fill="url(#grid-pattern)" height="24" width="24" />
                  </svg>
                ) : null}

                {/* SVG Render chính */}
                <svg
                  className="relative z-10 size-44 drop-shadow-md transition-all"
                  fill="none"
                  viewBox={`0 0 ${iconSpec.viewBoxSize} ${iconSpec.viewBoxSize}`}
                >
                  {iconSpec.containerFill === 'gradient' ? (
                    <defs>
                      <linearGradient id="canvas-gradient" x1="0%" x2="100%" y1="0%" y2="100%">
                        <stop offset="0%" stopColor={colorDef.primary} stopOpacity="0.35" />
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
                          ? 'url(#canvas-gradient)'
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

              <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
                <span>Lưới chuẩn: <strong>24x24 px</strong></span>
                <span>•</span>
                <span>Nét: <strong>{iconSpec.strokeWidth}px</strong></span>
                <span>•</span>
                <span>Bo góc: <strong>{iconSpec.cornerRadius}px</strong></span>
              </div>
            </CardContent>
          </Card>

          {/* Bảng điều khiển tham số (Inspector) */}
          <Card className="border-slate-800 bg-slate-900/80">
            <CardHeader className="border-b border-slate-800/80 px-4 py-3">
              <div className="flex items-center gap-2">
                <Sliders className="size-4 text-blue-400" />
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Tham số Định dạng Structured SVG
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-4 text-xs">
              {/* Chọn Khung Hình Học */}
              <div className="space-y-2">
                <label className="font-medium text-slate-300">Khung chứa hình học (Container Shape):</label>
                <div className="grid grid-cols-3 gap-2">
                  {SHAPE_OPTIONS.map(({ id, label, icon: IconComp }) => {
                    const isShapeSelected = iconSpec.containerShape === id;
                    return (
                      <button
                        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                          isShapeSelected
                            ? 'border-blue-500 bg-blue-600/20 text-white'
                            : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                        key={id}
                        onClick={() => setIconSpec({ ...iconSpec, containerShape: id })}
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
                <label className="font-medium text-slate-300">Kiểu nền (Background Fill):</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['none', 'solid', 'gradient'] as ContainerFill[]).map((fill) => {
                    const isFillSelected = iconSpec.containerFill === fill;
                    const labels: Record<ContainerFill, string> = {
                      none: 'Trong suốt',
                      solid: 'Đơn sắc',
                      gradient: 'Gradient chuyển',
                    };
                    return (
                      <button
                        className={`rounded-md border px-2.5 py-1.5 text-center text-xs transition-colors ${
                          isFillSelected
                            ? 'border-blue-500 bg-blue-600/20 text-white'
                            : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                        key={fill}
                        onClick={() => setIconSpec({ ...iconSpec, containerFill: fill })}
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
                <label className="font-medium text-slate-300">Tone màu thương hiệu SVNDTS:</label>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(BRAND_COLORS) as BrandColorKey[]).map((colorKey) => {
                    const c = BRAND_COLORS[colorKey];
                    const isColorSelected = iconSpec.colorTone === colorKey;
                    return (
                      <button
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all ${
                          isColorSelected
                            ? 'border-white bg-slate-800 text-white shadow-sm'
                            : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700'
                        }`}
                        key={colorKey}
                        onClick={() => setIconSpec({ ...iconSpec, colorTone: colorKey })}
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
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-slate-300">
                    <span>Độ dày nét:</span>
                    <strong className="text-blue-400">{iconSpec.strokeWidth} px</strong>
                  </div>
                  <input
                    className="w-full accent-blue-600"
                    max="3.0"
                    min="1.0"
                    onChange={(e) => setIconSpec({ ...iconSpec, strokeWidth: parseFloat(e.target.value) })}
                    step="0.25"
                    type="range"
                    value={iconSpec.strokeWidth}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-slate-300">
                    <span>Bo góc:</span>
                    <strong className="text-blue-400">{iconSpec.cornerRadius} px</strong>
                  </div>
                  <input
                    className="w-full accent-blue-600"
                    max="8"
                    min="2"
                    onChange={(e) => setIconSpec({ ...iconSpec, cornerRadius: parseInt(e.target.value, 10) })}
                    step="1"
                    type="range"
                    value={iconSpec.cornerRadius}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* CỘT 3: PREVIEW ĐA NGỮ CẢNH & EXPORT CODE (4 cột / 12) */}
        <div className="space-y-4 lg:col-span-4">
          {/* Xem trước thực tế (Live Mockup) */}
          <Card className="border-slate-800 bg-slate-900/80">
            <CardHeader className="border-b border-slate-800/80 px-4 py-3">
              <div className="flex items-center gap-2">
                <Eye className="size-4 text-blue-400" />
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Xem Trước Đa Ngữ Cảnh
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {/* Ngữ cảnh 1: Tab Favicon Trình Duyệt */}
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-400">1. Tab Trình Duyệt (Favicon 16px):</span>
                <div className="flex items-center gap-2 rounded-t-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-300">
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
                  <span className="truncate font-medium text-slate-200">SVNDTS Enterprise Portal</span>
                  <span className="ml-auto text-slate-500">✕</span>
                </div>
              </div>

              {/* Ngữ cảnh 2: Thanh Sidebar Navigation */}
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-400">2. Mục Điều Hướng Thanh Bên (Sidebar 20px):</span>
                <div className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs">
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
                  <span className="ml-auto rounded bg-blue-600/30 px-1.5 py-0.5 text-[10px] text-blue-300">Active</span>
                </div>
              </div>

              {/* Ngữ cảnh 3: Thẻ Phân Hệ (Module Card 32px) */}
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-400">3. Thẻ Phân Hệ Trang Chủ (Module Card):</span>
                <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
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
                    <h4 className="text-xs font-semibold text-white">{iconSpec.name}</h4>
                    <p className="line-clamp-1 text-[11px] text-slate-400">{iconSpec.description}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Hộp Xuất Mã Nguồn (Export Engine) */}
          <Card className="border-slate-800 bg-slate-900/80">
            <CardHeader className="border-b border-slate-800/80 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Code2 className="size-4 text-blue-400" />
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Bộ Xuất Mã Sạch
                  </CardTitle>
                </div>

                <div className="flex rounded-md border border-slate-800 bg-slate-950 p-0.5">
                  <button
                    className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                      activeCodeTab === 'svg' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    onClick={() => setActiveCodeTab('svg')}
                    type="button"
                  >
                    Clean SVG
                  </button>
                  <button
                    className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                      activeCodeTab === 'tsx' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
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
                <pre className="max-h-48 overflow-x-auto rounded-md border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                  {activeCodeTab === 'svg' ? cleanSvgCode : reactTsxCode}
                </pre>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  className="w-full bg-blue-600 text-white hover:bg-blue-500"
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
