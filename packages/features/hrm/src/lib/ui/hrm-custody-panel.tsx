'use client';

import { Package } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type { HrmCustodyAsset } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from './button';
import { STAGED_NOTICE, type HrmStagedChange, type HrmStageChange } from './hrm-staged-change';
import { ProfileCard } from './profile-cards';
import { toast } from './toast';

const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  INDUSTRIAL: 'Thiết bị công nghiệp',
  IT_OFFICE: 'Thiết bị CNTT, văn phòng',
  TOOL_PPE: 'Dụng cụ, bảo hộ',
  VEHICLE: 'Phương tiện',
};

function formatDate(value?: string): string {
  if (!value) return '----';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '----' : date.toLocaleDateString('vi-VN');
}

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly items: readonly HrmCustodyAsset[] };

type CustodyChange = NonNullable<HrmStagedChange['custody']>;

/**
 * Thẻ "Vật tư": tài sản công ty đang cấp cho nhân viên.
 *
 * Dữ liệu thuộc phân hệ Kho nên HRM đọc và ghi qua API HRM (`/employees/:id/custody`), API này gọi Kho bằng API nội
 * bộ; không có bản sao trong HRM. Ở chế độ sửa, người có `hrm.custody.manage` cấp hoặc thu hồi: thay đổi được ghi
 * nhận như các thẻ Hợp đồng, Người phụ thuộc và chỉ gửi sang Kho khi bấm "Lưu thay đổi".
 */
export function HrmCustodyPanel({
  employeeId,
  readOnly = true,
  onStage,
  stagedCustody = [],
}: {
  employeeId: string;
  readOnly?: boolean;
  onStage?: HrmStageChange;
  stagedCustody?: readonly CustodyChange[];
}) {
  const { can } = useHrmPermissions();
  const canManage = !readOnly && Boolean(onStage) && can('hrm.custody.manage');
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [assignable, setAssignable] = useState<readonly HrmCustodyAsset[]>([]);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    hrmFetch<HrmCustodyAsset[]>(`/employees/${encodeURIComponent(employeeId)}/custody`)
      .then((items) => {
        if (!cancelled) setState({ status: 'ready', items });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: cause instanceof Error ? cause.message : 'Không tải được danh sách vật tư từ Kho.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    hrmFetch<HrmCustodyAsset[]>('/custody/assignable')
      .then((items) => {
        if (!cancelled) setAssignable(items);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          toast.error({
            title: 'Không tải được danh sách tài sản có thể cấp',
            description: cause instanceof Error ? cause.message : undefined,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const pending = new Map(stagedCustody.map((change) => [change.code, change.action]));
  const choices = assignable.filter((asset) => pending.get(asset.code) !== 'assign');

  const stageAssign = () => {
    const asset = assignable.find((candidate) => candidate.code === selected);
    if (!asset || !onStage) return;
    onStage({
      label: `Cấp tài sản ${asset.code} - ${asset.name}`,
      custody: { code: asset.code, action: 'assign' },
      run: async () => {
        await hrmFetch(`/employees/${encodeURIComponent(employeeId)}/custody`, {
          method: 'POST',
          body: JSON.stringify({ materialCode: asset.code }),
        });
      },
    });
    setSelected('');
    toast.success(STAGED_NOTICE);
  };

  const stageRevoke = (asset: HrmCustodyAsset) => {
    onStage?.({
      label: `Thu hồi tài sản ${asset.code} - ${asset.name}`,
      custody: { code: asset.code, action: 'revoke' },
      run: async () => {
        await hrmFetch(
          `/employees/${encodeURIComponent(employeeId)}/custody/${encodeURIComponent(asset.code)}/revoke`,
          { method: 'POST' },
        );
      },
    });
    toast.success(STAGED_NOTICE);
  };

  const items = state.status === 'ready' ? state.items : [];

  return (
    <ProfileCard
      icon={Package}
      title="Vật tư"
      testId="hrm-custody-card"
      badge={
        state.status === 'ready' ? (
          <span className="text-xs font-semibold text-slate-500">{state.items.length}</span>
        ) : undefined
      }
    >
      {canManage && (
        <div className="mb-3 flex flex-wrap items-end gap-2" data-testid="hrm-custody-assign">
          <div className="min-w-[260px] flex-1">
            <SearchableSelect
              height={36}
              value={selected}
              placeholder="Chọn tài sản để cấp"
              searchPlaceholder="Tìm mã hoặc tên tài sản…"
              emptyText="Không còn tài sản có thể cấp"
              clearable
              options={choices.map((asset) => ({
                value: asset.code,
                label: asset.name,
                badge: asset.code,
              }))}
              onChange={(value) => setSelected(value || '')}
            />
          </div>
          <Button size="sm" className="h-9 text-[14px]" disabled={!selected} onClick={stageAssign}>
            Cấp tài sản
          </Button>
        </div>
      )}
      {state.status === 'loading' && <p className="text-sm text-slate-500">Đang tải…</p>}
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-amber-700">
          {state.message}
        </p>
      )}
      {state.status === 'ready' && items.length === 0 && (
        <p className="py-2 text-sm italic text-slate-500">Chưa được cấp phát vật tư, tài sản nào.</p>
      )}
      {state.status === 'ready' && items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2 pr-3">Mã</th>
                <th className="py-2 pr-3">Tên tài sản</th>
                <th className="py-2 pr-3">Nhóm</th>
                <th className="py-2 pr-3">Số sê-ri</th>
                <th className="py-2">Ngày cấp</th>
                {canManage && <th className="py-2 text-right">Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const revoking = pending.get(item.code) === 'revoke';
                return (
                  <tr
                    key={item.id}
                    className={`border-b border-slate-100 last:border-0 ${revoking ? 'bg-amber-50' : ''}`}
                  >
                    <td className="py-2 pr-3 font-mono text-[13px]">{item.code}</td>
                    <td className="py-2 pr-3 font-medium text-slate-900">{item.name}</td>
                    <td className="py-2 pr-3">
                      {(item.assetCategory && CATEGORY_LABEL[item.assetCategory]) || '----'}
                    </td>
                    <td className="py-2 pr-3">{item.serialNumber || '----'}</td>
                    <td className="py-2">{formatDate(item.assignedAt)}</td>
                    {canManage && (
                      <td className="py-2 text-right">
                        {revoking ? (
                          <span className="text-xs font-semibold text-amber-800">Chờ thu hồi</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => stageRevoke(item)}
                          >
                            Thu hồi
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canManage && stagedCustody.some((change) => change.action === 'assign') && (
        <p className="mt-2 text-xs font-semibold text-amber-800">
          Có {stagedCustody.filter((change) => change.action === 'assign').length} tài sản chờ cấp, sẽ ghi vào hồ sơ khi
          bấm "Lưu thay đổi".
        </p>
      )}
    </ProfileCard>
  );
}
