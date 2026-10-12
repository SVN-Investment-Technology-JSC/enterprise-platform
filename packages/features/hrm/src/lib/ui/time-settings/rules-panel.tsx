'use client';
/**
 * Mục "Quy định chấm công": cột trái là các phiên bản theo ngày hiệu lực, cột phải (từ `@4xl`) là thẻ tóm tắt quy định
 * đang áp dụng lấy từ `config_json` thật của phiên bản hiện hành. Hẹp thì xếp một cột, tóm tắt lên trước.
 * Chỉ lo giao diện; việc tạo phiên bản do màn hình cha mở hộp thoại.
 */
import type { ReactNode } from 'react';
import {
  CalendarDays,
  CalendarOff,
  Globe,
  History,
  MapPin,
  Network,
  Plus,
  ShieldCheck,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../button';
import { EmptyPanel, IconTile, InfoNote, SettingsSection, StatusPill, type KitTone, type PillTone } from '../settings-kit';
import { Pager, ResponsiveList, usePaged, type ListColumn } from './responsive-list';
import {
  conditionChips,
  countScopedInForce,
  pickCurrentVersion,
  summarizeVersion,
  today,
  versionRangeLabel,
  versionScopeLabel,
  versionStatusLabel,
  type PolicyVersion,
  type Settings,
  type VersionState,
} from './time-settings-model';

const STATE_TONE: Record<VersionState, PillTone> = {
  'Đang áp dụng': 'green',
  'Chưa hiệu lực': 'blue',
  'Hết hiệu lực': 'slate',
};

function SummaryRow({
  icon,
  tone,
  label,
  value,
}: {
  icon: LucideIcon;
  tone: KitTone;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5">
      <IconTile icon={icon} tone={tone} size="sm" />
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="break-words text-[13px] font-semibold leading-snug text-slate-900">{value}</p>
      </div>
    </div>
  );
}

export function RulesPanel({
  versions,
  onCreate,
}: {
  versions: Settings['versions'];
  onCreate: () => void;
}) {
  const day = today();
  const current = pickCurrentVersion(versions, day);
  const scoped = countScopedInForce(versions, day);
  const summary = current ? summarizeVersion(current) : null;
  const paged = usePaged(versions, 10);

  const columns: ListColumn<PolicyVersion>[] = [
    {
      id: 'version',
      header: 'Phiên bản',
      primary: true,
      cell: (v) => (
        <span>
          <span className="font-mono text-sm font-bold text-blue-700 @2xl:text-xs">v{v.version_no}</span>{' '}
          <span className="text-xs text-slate-600">{v.policy_name ?? v.policy_code ?? ''}</span>
        </span>
      ),
    },
    { id: 'range', header: 'Hiệu lực', cell: (v) => versionRangeLabel(v) },
    { id: 'scope', header: 'Phạm vi', cell: (v) => versionScopeLabel(v) },
    {
      id: 'conditions',
      header: 'Điều kiện',
      cell: (v) => {
        const chips = conditionChips(v);
        return (
          <span className="flex flex-wrap items-center gap-1">
            {chips.length ? (
              chips.map((c) => (
                <span
                  key={c}
                  className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-700"
                >
                  {c}
                </span>
              ))
            ) : (
              <span className="text-slate-500">Không kiểm soát</span>
            )}
          </span>
        );
      },
    },
    {
      id: 'state',
      header: 'Trạng thái',
      cell: (v) => {
        const label = versionStatusLabel(v, day);
        return <StatusPill tone={STATE_TONE[label]}>{label}</StatusPill>;
      },
    },
  ];

  return (
    <div className="grid grid-cols-1 items-start gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]">
      <SettingsSection
        icon={History}
        tone="blue"
        title="Phiên bản quy định"
        description="Mỗi phiên bản có ngày hiệu lực riêng; phiên bản mới kết thúc phiên bản cũ cùng phạm vi."
        className="@4xl:col-start-1 @4xl:row-start-1"
      >
        {versions.length === 0 ? (
          <EmptyPanel
            icon={ShieldCheck}
            title="Chưa có phiên bản quy định"
            description="Chưa cấu hình điều kiện IP, GPS hoặc thiết bị."
            action={
              <Button permission="hrm.time.configure" onClick={onCreate} className="h-9 gap-1.5 px-4 text-xs font-semibold">
                <Plus className="size-4" />
                Tạo phiên bản mới
              </Button>
            }
          />
        ) : (
          <>
            <ResponsiveList
              label="Phiên bản quy định chấm công"
              rows={paged.pageRows}
              rowKey={(v) => v.id}
              columns={columns}
              gridClass="@2xl:grid-cols-[minmax(0,7.5rem)_minmax(0,11rem)_minmax(0,6.5rem)_minmax(0,1fr)_6.5rem]"
            />
            <Pager paged={paged} />
          </>
        )}
      </SettingsSection>

      <aside className="order-first space-y-4 @4xl:order-none @4xl:col-start-2 @4xl:row-start-1">
        <SettingsSection
          icon={ShieldCheck}
          tone="amber"
          title="Tóm tắt quy định đang áp dụng"
          description={
            current && summary
              ? `Phiên bản v${current.version_no} · từ ${summary.range.split(' - ')[0]}`
              : 'Quy định chung đang có hiệu lực hôm nay.'
          }
          bodyClassName="space-y-2"
        >
          {summary ? (
            <>
              <SummaryRow icon={CalendarDays} tone="blue" label="Phạm vi & hiệu lực" value={`${summary.scope} · ${summary.range}`} />
              <SummaryRow icon={Network} tone="amber" label="Kiểm soát IP" value={summary.ip} />
              <SummaryRow icon={MapPin} tone="green" label="Kiểm soát GPS" value={summary.gps} />
              <SummaryRow icon={Smartphone} tone="violet" label="Thiết bị chấm công" value={summary.device} />
              <SummaryRow icon={Globe} tone="blue" label="Múi giờ" value={summary.timezone} />
              <SummaryRow icon={CalendarOff} tone="orange" label="Ngày nghỉ hằng tuần" value={summary.weeklyOff} />
            </>
          ) : (
            <EmptyPanel
              title="Chưa có quy định đang áp dụng"
              description="Tạo phiên bản mới để thiết lập điều kiện chấm công cho toàn công ty."
              className="py-6"
            />
          )}
          {scoped > 0 ? (
            <InfoNote tone="blue">
              Có {scoped} phiên bản đang chạy thử cho một nhóm nhân viên, ưu tiên hơn quy định chung với nhóm đó.
            </InfoNote>
          ) : null}
        </SettingsSection>
        <InfoNote tone="amber">
          Thay đổi quy định ảnh hưởng đến cách xác thực chấm công từ ngày hiệu lực; kiểm tra kỹ trước khi tạo phiên bản.
        </InfoNote>
      </aside>
    </div>
  );
}
