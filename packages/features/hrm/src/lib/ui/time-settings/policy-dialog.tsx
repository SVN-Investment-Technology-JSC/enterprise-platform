'use client';
/**
 * Hộp thoại tạo phiên bản quy định chấm công. Các trường gom theo chức năng (hiệu lực và phạm vi, kiểm soát chấm công,
 * thời gian và ngày nghỉ, lý do); một cột khi hẹp, hai cột từ `@lg` của chính hộp thoại. Nội dung cuộn trong, nút ở chân.
 * Chỉ lo giao diện: dữ liệu nhập và việc gửi nằm ở màn hình cha.
 */
import { useId, type ReactNode } from 'react';
import { CalendarRange, Clock, FileText, ShieldCheck, X, type LucideIcon } from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '../date-picker-input';
import { Button } from '../button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { Input } from '../input';
import { IconTile, InfoNote, RadioCards, SettingsField, SettingsSwitch, type KitTone } from '../settings-kit';
import {
  type EmployeeOption,
  type PolicyFormState,
} from './time-settings-model';

export function FormBlock({
  icon,
  tone,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  tone: KitTone;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-3.5 @xl:p-4">
      <div className="flex items-start gap-2.5">
        <IconTile icon={icon} tone={tone} size="sm" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          {description ? <p className="text-[12px] leading-snug text-slate-500">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <SettingsSwitch label={label} checked={checked} onChange={onChange} />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-800">{label}</p>
        <p className="text-[12px] leading-snug text-slate-500">{description}</p>
      </div>
    </div>
  );
}

export function PolicyDialog({
  open,
  busy,
  policy,
  setPolicy,
  employees,
  impact,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  policy: PolicyFormState;
  setPolicy: (next: PolicyFormState) => void;
  employees: EmployeeOption[];
  impact: { closing: string[]; blocking: string[] };
  onClose: () => void;
  onSubmit: () => void;
}) {
  const uid = useId();
  const patch = (next: Partial<PolicyFormState>) => setPolicy({ ...policy, ...next });
  const nameOf = (id: string) => employees.find((e) => e.value === id)?.label ?? 'Nhân viên đã ngừng';
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] gap-0 bg-white p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-5 py-4 pr-12">
          <DialogTitle>Tạo phiên bản quy định chấm công</DialogTitle>
          <DialogDescription>
            Phiên bản mới có hiệu lực từ ngày chọn và kết thúc phiên bản đang áp dụng cùng phạm vi.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="@container min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/50 p-3 @xl:p-5">
            <FormBlock
              icon={CalendarRange}
              tone="blue"
              title="Hiệu lực & phạm vi"
              description="Thời gian áp dụng và nhân viên được áp dụng."
            >
              <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
                <SettingsField label="Hiệu lực từ" required htmlFor={`${uid}-from`}>
                  <DatePickerInput
                    height={36}
                    id={`${uid}-from`}
                    required
                    className="[&_input]:h-9"
                    value={policy.effectiveFrom}
                    onChange={(v: string) => patch({ effectiveFrom: v })}
                  />
                </SettingsField>
                <SettingsField label="Hiệu lực đến (tùy chọn)" htmlFor={`${uid}-to`}>
                  <DatePickerInput
                    height={36}
                    id={`${uid}-to`}
                    min={policy.effectiveFrom}
                    className="[&_input]:h-9"
                    value={policy.effectiveTo}
                    onChange={(v: string) => patch({ effectiveTo: v })}
                  />
                </SettingsField>
              </div>
              <RadioCards
                label="Phạm vi áp dụng"
                value={policy.scope}
                onChange={(scope) => patch({ scope })}
                options={[
                  { value: 'ALL', title: 'Toàn công ty', description: 'Áp dụng cho mọi nhân viên' },
                  {
                    value: 'EMPLOYEES',
                    title: 'Một số nhân viên (chạy thử)',
                    description: 'Chỉ áp dụng cho nhân viên được chọn',
                  },
                ]}
              />
              {policy.scope === 'EMPLOYEES' && (
                <div className="space-y-2">
                  <SearchableSelect
                    height={36}
                    value=""
                    placeholder="Tìm nhân viên để thêm"
                    onChange={(id) =>
                      id &&
                      !policy.employeeIds.includes(id) &&
                      patch({ employeeIds: [...policy.employeeIds, id] })
                    }
                    options={employees.filter((e) => !policy.employeeIds.includes(e.value))}
                  />
                  {policy.employeeIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {policy.employeeIds.map((id) => (
                        <button
                          key={id}
                          type="button"
                          aria-label={`Bỏ ${nameOf(id)}`}
                          className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-2.5 pr-2 text-xs text-slate-700 hover:bg-slate-100"
                          onClick={() =>
                            patch({ employeeIds: policy.employeeIds.filter((x) => x !== id) })
                          }
                        >
                          <span className="truncate">{nameOf(id)}</span>
                          <X aria-hidden="true" className="size-3 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {impact.closing.length > 0 && (
                <InfoNote tone="slate">
                  <div className="space-y-1">
                    {impact.closing.map((t) => (
                      <p key={t}>{t}</p>
                    ))}
                  </div>
                </InfoNote>
              )}
              {impact.blocking.length > 0 && (
                <InfoNote tone="red" role="alert">
                  Khoảng hiệu lực giao với phiên bản đã có ngày kết thúc hoặc bắt đầu muộn hơn, hệ thống sẽ từ chối:{' '}
                  {impact.blocking.join('; ')}
                </InfoNote>
              )}
            </FormBlock>

            <FormBlock
              icon={ShieldCheck}
              tone="green"
              title="Kiểm soát chấm công"
              description="Điều kiện để một lần chấm công được coi là hợp lệ."
            >
              <SwitchRow
                label="Yêu cầu IP được phép"
                description="Chỉ chấm công từ địa chỉ IP trong danh sách bên dưới."
                checked={policy.requireIp}
                onChange={(requireIp) => patch({ requireIp })}
              />
              <SettingsField
                label="IP hoặc dải CIDR được phép"
                htmlFor={`${uid}-ips`}
                hint="Ví dụ: 203.0.113.10, 10.0.0.0/24; phân cách bằng dấu phẩy."
              >
                <Input
                  id={`${uid}-ips`}
                  className="h-9 text-xs"
                  value={policy.allowedIps}
                  onChange={(e) => patch({ allowedIps: e.target.value })}
                />
              </SettingsField>
              <div className="border-t border-slate-100 pt-3">
                <SwitchRow
                  label="Yêu cầu GPS trong bán kính"
                  description="Vị trí chấm công phải nằm trong bán kính của một địa điểm GPS."
                  checked={policy.requireGps}
                  onChange={(requireGps) => patch({ requireGps })}
                />
              </div>
              <SettingsField
                label="Dung sai GPS (m)"
                htmlFor={`${uid}-tolerance`}
                hint="Sai số định vị tối đa chấp nhận, từ 1 đến 1000 m."
              >
                <Input
                  id={`${uid}-tolerance`}
                  type="number"
                  min={1}
                  max={1000}
                  className="h-9 text-xs"
                  value={policy.maxGpsAccuracyMeters}
                  onChange={(e) => patch({ maxGpsAccuracyMeters: Number(e.target.value) })}
                />
              </SettingsField>
              <div className="border-t border-slate-100 pt-3">
                <SwitchRow
                  label="Một trình duyệt chấm công đã duyệt cho mỗi nhân viên"
                  description="Chỉ thiết bị đã được duyệt mới chấm công được."
                  checked={policy.requireDevice}
                  onChange={(requireDevice) => patch({ requireDevice })}
                />
              </div>
            </FormBlock>

            <FormBlock
              icon={Clock}
              tone="violet"
              title="Múi giờ"
              description="Múi giờ dùng để xác định ngày chấm công. Ngày nghỉ hằng tuần khai báo ở Phân ca."
            >
              <SettingsField label="Múi giờ" required htmlFor={`${uid}-tz`}>
                <Input
                  id={`${uid}-tz`}
                  required
                  className="h-9 text-xs"
                  value={policy.timezone}
                  onChange={(e) => patch({ timezone: e.target.value })}
                />
              </SettingsField>
            </FormBlock>

            <FormBlock
              icon={FileText}
              tone="amber"
              title="Ghi nhận thay đổi"
              description="Lý do được lưu vào nhật ký để dễ theo dõi."
            >
              <SettingsField label="Lý do thay đổi" required htmlFor={`${uid}-reason`}>
                <Input
                  id={`${uid}-reason`}
                  required
                  maxLength={2000}
                  className="h-9 text-xs"
                  placeholder="Ví dụ: Bật kiểm soát GPS cho khối văn phòng"
                  value={policy.reason}
                  onChange={(e) => patch({ reason: e.target.value })}
                />
              </SettingsField>
            </FormBlock>
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose} className="h-9 px-4 text-xs">
              Hủy
            </Button>
            <Button type="submit" disabled={busy} className="h-9 px-4 text-xs font-semibold">
              {busy ? 'Đang lưu…' : 'Tạo phiên bản'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
