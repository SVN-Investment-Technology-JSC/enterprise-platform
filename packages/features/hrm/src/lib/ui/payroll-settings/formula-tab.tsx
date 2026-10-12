'use client';
/** Tab Công thức: danh sách phiên bản công thức lương và quy định OT (kèm dòng thời gian), thao tác soạn/kết thúc/xóa. */
import { Calculator, Clock, Copy, GitBranch, Lock, Plus } from 'lucide-react';
import { formatDateVn } from '../../personnel-decision-rules';
import { minutesToTime } from '../../hrm-payroll-config';
import { Button } from '../button';
import { PayrollVersionTimeline } from '../payroll-version-timeline';
import { InfoNote, SettingsSection, StatusPill } from '../settings-kit';
import { ActionMenu, DataList, ExpandToggle, type DataColumn } from './data-rows';
import {
  OT_FIELDS,
  VERSION_STATE_LABEL,
  VERSION_STATE_TONE,
  editLockReason,
  versionState,
  type Version,
} from './types';

function VersionDetails({ v, lock }: { v: Version; lock: string }) {
  return (
    <div className="space-y-2">
      {lock ? <p className="text-[11px] text-amber-700">Không sửa trực tiếp được: {lock}.</p> : null}
      {v.policy_type === 'OT' && (
        <dl className="grid grid-cols-2 gap-2 text-xs @3xl:grid-cols-3 @5xl:grid-cols-4">
          {OT_FIELDS.map(([key, label]) => (
            <div key={key} className="rounded-md border border-slate-200 bg-white p-2">
              <dt className="text-[11px] text-slate-500">{label}</dt>
              <dd className="font-semibold text-slate-800">{String(v.config_json[key] ?? 'Chưa cấu hình')}</dd>
            </div>
          ))}
          {(
            [
              ['nightStartMinute', 'Bắt đầu giờ đêm'],
              ['nightEndMinute', 'Kết thúc giờ đêm'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="rounded-md border border-slate-200 bg-white p-2">
              <dt className="text-[11px] text-slate-500">{label}</dt>
              <dd className="font-semibold text-slate-800">
                {minutesToTime(v.config_json[key] as number | undefined) || 'Mặc định'}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {v.config_json.components?.map((c) => (
        <div
          key={c.code}
          className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 rounded-md border border-slate-200 bg-white p-2 text-xs"
        >
          <span className="font-semibold text-slate-900">
            {c.name} ({c.code})
          </span>
          <span className="max-w-full rounded bg-slate-100 px-2 py-0.5 font-mono break-all text-slate-600">{c.formula}</span>
        </div>
      ))}
    </div>
  );
}

function CurrentBar({
  current,
  label,
  onNext,
  canManage,
}: {
  current: Version | undefined;
  label: string;
  onNext: (v: Version) => void;
  canManage: boolean;
}) {
  if (!current)
    return (
      <InfoNote tone="amber">
        Chưa có {label} đang áp dụng. Thêm phiên bản mới để hệ thống có cấu hình khi tính lương.
      </InfoNote>
    );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2.5">
      <StatusPill tone="green">Đang áp dụng</StatusPill>
      <span className="font-mono text-sm font-bold text-slate-900">v{current.version_no}</span>
      <span className="min-w-0 flex-1 basis-40 text-xs text-slate-600">
        Hiệu lực từ {formatDateVn(current.effective_from)}
        {current.config_json.components ? ` · ${current.config_json.components.length} thành phần` : ''}
      </span>
      {canManage ? (
        <Button type="button" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => onNext(current)}>
          <Copy className="size-3.5" />
          Tạo bản kế tiếp
        </Button>
      ) : null}
    </div>
  );
}

export function FormulaTab({
  versions,
  canManage,
  onNewFormula,
  onEditFormula,
  onEditOt,
  onEnd,
}: {
  versions: Version[];
  canManage: boolean;
  onNewFormula: () => void;
  onEditFormula: (v: Version, clone: boolean) => void;
  onEditOt: (v?: Version, clone?: boolean) => void;
  onEnd: (v: Version, remove: boolean) => void;
}) {
  const today = new Date().toLocaleDateString('en-CA');
  const byType = (type: string) =>
    versions
      .filter((v) => v.policy_type === type)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.version_no - a.version_no);
  const payroll = byType('PAYROLL');
  const ot = byType('OT');
  const currentOf = (list: Version[]) => list.find((v) => versionState(v, today) === 'active');

  const columns = (type: 'PAYROLL' | 'OT'): DataColumn<Version>[] => [
    {
      key: 'version',
      header: 'Phiên bản',
      width: '90px',
      cardOrder: -1,
      cell: (v, { expanded, toggle }) => (
        <span className="flex items-center gap-1">
          <ExpandToggle expanded={expanded} onClick={toggle} label={`Chi tiết v${v.version_no}`} />
          <span className="font-mono text-sm font-semibold text-slate-900">v{v.version_no}</span>
        </span>
      ),
    },
    {
      key: 'state',
      header: 'Trạng thái',
      width: '130px',
      cell: (v) => {
        const state = versionState(v, today);
        return <StatusPill tone={VERSION_STATE_TONE[state]}>{VERSION_STATE_LABEL[state]}</StatusPill>;
      },
    },
    {
      key: 'range',
      header: 'Thời gian hiệu lực',
      width: 'minmax(0,1fr)',
      cardFull: true,
      cardOrder: 1,
      cardLabel: true,
      cell: (v) => (
        <span className="text-slate-700">
          {formatDateVn(v.effective_from)} - {v.effective_to ? formatDateVn(v.effective_to) : 'Đến nay'}
        </span>
      ),
    },
    {
      key: 'lock',
      header: 'Khóa sửa',
      width: '150px',
      cardOrder: 1,
      cell: (v) =>
        v.used ? (
          <span title="Đã được kỳ lương/OT/phép tham chiếu: không sửa hoặc xóa; tạo phiên bản kế tiếp có hiệu lực sau kỳ đó">
            <StatusPill tone="slate">
              <Lock aria-hidden="true" className="mr-1 size-3" />
              Đã dùng - khóa sửa
            </StatusPill>
          </span>
        ) : null,
    },
    {
      key: 'actions',
      header: 'Thao tác',
      width: '48px',
      cardEnd: true,
      cell: (v) => {
        const lock = editLockReason(v, versions);
        const editOne = () => (type === 'OT' ? onEditOt(v) : onEditFormula(v, false));
        const cloneOne = () => (type === 'OT' ? onEditOt(v, true) : onEditFormula(v, true));
        return (
          <ActionMenu
            label={`Thao tác phiên bản v${v.version_no}`}
            items={[
              { key: 'edit', label: 'Sửa', onSelect: editOne, hidden: !canManage || !!lock },
              { key: 'clone', label: 'Tạo bản kế tiếp', onSelect: cloneOne, hidden: !canManage },
              { key: 'end', label: 'Kết thúc hiệu lực', onSelect: () => onEnd(v, false), hidden: !canManage || !!v.effective_to },
              {
                key: 'remove',
                label: 'Xóa chưa dùng',
                tone: 'danger',
                onSelect: () => onEnd(v, true),
                hidden: !canManage || !!v.used || v.effective_from.slice(0, 10) <= today,
              },
            ]}
          />
        );
      },
    },
  ];

  return (
    <div className="grid grid-cols-1 items-start gap-4 @5xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        <SettingsSection
          icon={Calculator}
          title="Công thức lương"
          description="Các khoản thu nhập, khấu trừ và công thức tính lương theo mốc hiệu lực."
          actions={
            <Button permission="hrm.payroll.configure" onClick={onNewFormula} className="h-9 gap-1.5 px-3 text-xs font-semibold">
              <Plus className="size-4" />
              <span>Thêm công thức lương</span>
            </Button>
          }
          bodyClassName="space-y-3"
        >
          <CurrentBar current={currentOf(payroll)} label="công thức lương" canManage={canManage} onNext={(v) => onEditFormula(v, true)} />
          <DataList
            label="Phiên bản công thức lương"
            rows={payroll}
            rowKey={(v) => v.id}
            columns={columns('PAYROLL')}
            pageSize={8}
            empty={<p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">Chưa có phiên bản công thức lương.</p>}
            renderExpanded={(v) => <VersionDetails v={v} lock={editLockReason(v, versions)} />}
          />
        </SettingsSection>

        <SettingsSection
          icon={Clock}
          tone="amber"
          title="Quy định tăng ca (OT)"
          description="Giới hạn giờ làm thêm, hệ số OT và khung giờ đêm theo mốc hiệu lực."
          actions={
            <Button permission="hrm.payroll.configure" variant="outline" onClick={() => onEditOt()} className="h-9 gap-1.5 px-3 text-xs font-semibold">
              <Clock className="size-3.5" />
              <span>Cấu hình OT</span>
            </Button>
          }
          bodyClassName="space-y-3"
        >
          <CurrentBar current={currentOf(ot)} label="quy định OT" canManage={canManage} onNext={(v) => onEditOt(v, true)} />
          <DataList
            label="Phiên bản quy định OT"
            rows={ot}
            rowKey={(v) => v.id}
            columns={columns('OT')}
            pageSize={8}
            empty={<p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">Chưa có phiên bản quy định OT.</p>}
            renderExpanded={(v) => <VersionDetails v={v} lock={editLockReason(v, versions)} />}
          />
        </SettingsSection>
      </div>

      <SettingsSection
        icon={GitBranch}
        tone="violet"
        title="Dòng thời gian phiên bản"
        description="Kiểm tra khoảng trống hoặc chồng lấn hiệu lực giữa các phiên bản cùng loại."
      >
        <PayrollVersionTimeline versions={versions} />
      </SettingsSection>
    </div>
  );
}
