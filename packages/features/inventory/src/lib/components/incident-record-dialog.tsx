'use client';

import type { Asset } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, CloseGuard } from '@enterprise-platform/shared-ui';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

export interface IncidentLogRecord {
  id: string;
  date: string;
  title: string;
  badge: string;
  badgeType: 'success' | 'warn' | 'info' | 'danger';
  desc: string;
  actor: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  workOrderRef?: string;
  source?: 'inventory_local' | 'maintenance_module';
  syncToMaintenance?: boolean;
}

export function IncidentRecordDialog({
  asset,
  onCancel,
  onSubmit,
}: {
  asset: Asset;
  onCancel: () => void;
  onSubmit: (log: IncidentLogRecord) => void;
}) {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('MEDIUM');
  const [category, setCategory] = useState('Hỏng hóc / Kẹt cơ khí');
  const [description, setDescription] = useState('');
  const [reporter, setReporter] = useState('KTV. Vận hành');
  const [syncToMaintenance, setSyncToMaintenance] = useState(true);

  const isFormValid = title.trim().length > 0 && description.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;

    const now = new Date();
    const formattedDate = `${String(now.getDate()).padStart(2, '0')}/${String(
      now.getMonth() + 1,
    ).padStart(2, '0')}/${now.getFullYear()}`;

    const severityLabels: Record<string, { badge: string; badgeType: 'info' | 'warn' | 'danger' }> = {
      LOW: { badge: 'Sự cố Nhẹ (P4)', badgeType: 'info' },
      MEDIUM: { badge: 'Sự cố Vừa (P3)', badgeType: 'warn' },
      HIGH: { badge: 'Sự cố Nghiêm trọng (P2)', badgeType: 'danger' },
      CRITICAL: { badge: 'Khẩn cấp / Dừng máy (P1)', badgeType: 'danger' },
    };

    const config = severityLabels[severity] || { badge: 'Sự cố', badgeType: 'warn' };
    const simulatedWoNumber = `INC-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const newLog: IncidentLogRecord = {
      id: `incident-${Date.now()}`,
      date: formattedDate,
      title: `[${category}] ${title.trim()}`,
      badge: config.badge,
      badgeType: config.badgeType,
      desc: description.trim(),
      actor: reporter.trim() || 'KTV. Vận hành',
      severity,
      workOrderRef: simulatedWoNumber,
      source: 'inventory_local',
      syncToMaintenance,
    };

    onSubmit(newLog);
  };

  const dirtySnapshot = JSON.stringify([title, severity, category, description, reporter, syncToMaintenance]);
  const [initialSnapshot] = useState(dirtySnapshot);
  const isDirty = dirtySnapshot !== initialSnapshot;

  return (
    <Dialog onEscape={isDirty ? undefined : onCancel}>
      <DialogContent className="max-w-[580px]" aria-label="Ghi nhận sự cố thiết bị">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <div>
              <DialogTitle>
                <AlertTriangle size={20} color="#dc2626" />
                Ghi nhận sự cố thiết bị
              </DialogTitle>
              <p className="mt-1 mb-0 text-sm text-slate-500">
                Thiết bị: <strong>{asset.name}</strong> ({asset.code})
              </p>
            </div>
            <CloseGuard dirty={isDirty} onClose={onCancel}>
              <DialogCloseButton />
            </CloseGuard>
          </DialogHeader>

          <DialogBody className="grid gap-4">
          {/* Mức độ ưu tiên / Nghiêm trọng */}
          <div>
            <Label className="mb-1.5 text-sm text-slate-700" required>Mức độ sự cố / Mức độ ưu tiên</Label>
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  { id: 'LOW', label: 'Thấp (P4)', color: '#64748b', bg: '#f8fafc', border: '#cbd5e1' },
                  { id: 'MEDIUM', label: 'Trung bình (P3)', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
                  { id: 'HIGH', label: 'Cao (P2)', color: '#ea580c', bg: '#fff7ed', border: '#fed7aa' },
                  { id: 'CRITICAL', label: 'Khẩn cấp (P1)', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
                ] as const
              ).map((lvl) => {
                const isSelected = severity === lvl.id;
                return (
                  <button
                    key={lvl.id}
                    type="button"
                    onClick={() => setSeverity(lvl.id)}
                    className={cn(
                      'cursor-pointer rounded-md px-1 py-2 text-center text-[13px] transition-all',
                      isSelected ? 'border-2 font-bold' : 'border bg-white font-medium text-slate-600',
                    )}
                    style={
                      isSelected
                        ? { borderColor: lvl.color, background: lvl.bg, color: lvl.color }
                        : { borderColor: lvl.border }
                    }
                  >
                    {lvl.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Phân loại sự cố & Người báo cáo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 text-sm text-slate-700">Phân loại sự cố</Label>
              <SearchableSelect
                options={[
                  { value: 'Hỏng hóc / Kẹt cơ khí', label: 'Hỏng hóc / Kẹt cơ khí' },
                  { value: 'Sự cố điện / Chập cháy / Điều khiển', label: 'Sự cố điện / Chập cháy / Điều khiển' },
                  { value: 'Rò rỉ dầu / Khí / Áp suất', label: 'Rò rỉ dầu / Khí / Áp suất' },
                  { value: 'Nhiệt độ / Rung động bất thường', label: 'Nhiệt độ / Rung động cao' },
                  { value: 'Lỗi phần mềm / Cảm biến SCADA', label: 'Lỗi cảm biến / SCADA' },
                  { value: 'Khác', label: 'Khác' },
                ]}
                value={category}
                onChange={(val) => setCategory(val)}
                placeholder="Tìm hoặc chọn phân loại sự cố…"
                emptyText="Không tìm thấy phân loại phù hợp"
                clearable={false}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <Label className="mb-1.5 text-sm text-slate-700">Người ghi nhận / Báo cáo</Label>
              <Input
                type="text"
                value={reporter}
                onChange={(e) => setReporter(e.target.value)}
                placeholder="VD: KTV. Nguyễn Văn A"
              />
            </div>
          </div>

          {/* Tiêu đề tóm tắt sự cố */}
          <div>
            <Label className="mb-1.5 text-sm text-slate-700" required>Tiêu đề tóm tắt sự cố</Label>
            <Input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Phát hiện tiếng ồn lạ và nhiệt độ thân bơm tăng cao"
              required
            />
          </div>

          {/* Chi tiết mô tả */}
          <div>
            <Label className="mb-1.5 text-sm text-slate-700" required>Mô tả chi tiết hiện trường & Triệu chứng</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mô tả cụ thể biểu hiện lúc xảy ra sự cố, tác động tới dây chuyền, các biện pháp sơ bộ đã thực hiện..."
              required
              className="resize-y"
            />
          </div>

          {/* Checkbox đồng bộ sang module Bảo trì nếu có */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <label className="m-0 flex cursor-pointer items-center gap-2 text-[13px] text-slate-700">
              <input
                type="checkbox"
                checked={syncToMaintenance}
                onChange={(e) => setSyncToMaintenance(e.target.checked)}
                className="cursor-pointer"
              />
              <span>
                <strong>Đồng bộ sang Module Bảo trì (CMMS):</strong> Tự động tạo phiếu sự cố khẩn cấp (Incident Ticket) nếu đơn vị có kích hoạt module Bảo trì.
              </span>
            </label>
          </div>

          </DialogBody>

          <DialogFooter>
            <CloseGuard dirty={isDirty} onClose={onCancel}>
              <Button type="button" variant="outline">
                Đóng
              </Button>
            </CloseGuard>
            <Button type="submit" disabled={!isFormValid}>
              Lưu &amp; Ghi nhận nhật ký
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
