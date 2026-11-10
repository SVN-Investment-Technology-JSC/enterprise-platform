'use client';
import { useState } from 'react';
import { cn } from '../utils';
import { PageTitle } from '../ui/page-title';
import { CompOffBalancesPanel } from '../ui/comp-off/comp-off-balances-panel';
import { CompOffConversionPanel } from '../ui/comp-off/comp-off-conversion-panel';
import { OvertimeClassifyPanel } from '../ui/comp-off/overtime-classify-panel';

type SubTab = 'balances' | 'conversion' | 'classify';

const SUB_TABS: readonly { id: SubTab; label: string }[] = [
  { id: 'balances', label: 'Số dư' },
  { id: 'conversion', label: 'Chuyển đổi tháng' },
  { id: 'classify', label: 'Phân loại làm thêm' },
];

/**
 * Quỹ nghỉ bù: số dư theo nhân viên, chuyển đổi giờ dư của tháng đã chốt thành ngày nghỉ bù, và phân loại làm thêm / ca đêm
 * theo từng ca. Quyền xem quỹ (`hrm.comp_off.view`) mở cả ba mục; thao tác ghi do từng mục kiểm quyền riêng.
 */
export default function CompOffScreen() {
  const [tab, setTab] = useState<SubTab>('balances');
  const visible = SUB_TABS;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-1">
      <PageTitle
        title="Quỹ nghỉ bù"
        description="Giờ làm thêm vượt trần của tháng đã chốt công được quy đổi thành ngày nghỉ bù. Nghỉ bù được dùng theo bước nửa ngày, lấy từ lô gần hết hạn trước."
      />
      <div role="tablist" aria-label="Mục quỹ nghỉ bù" className="flex gap-1 border-b border-slate-200">
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-semibold',
              tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'balances' ? <CompOffBalancesPanel /> : null}
      {tab === 'conversion' ? <CompOffConversionPanel /> : null}
      {tab === 'classify' ? <OvertimeClassifyPanel /> : null}
    </div>
  );
}
