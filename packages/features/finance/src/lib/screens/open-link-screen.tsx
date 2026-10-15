'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FinanceVoucherKind } from '@enterprise-platform/contracts-finance';
import { financeErrorMessage, financeFetch } from '../finance-api';
import { FINANCE_KIND_CONFIG } from '../finance-kinds';
import { ErrorBanner } from '../ui/form-parts';

/**
 * Đích của liên kết từ hồ sơ quy trình (Procedure) sang Tài chính: `sourceId` của hồ sơ là id lần gửi duyệt,
 * màn này đổi nó thành phiếu rồi chuyển tới trang chi tiết đúng loại.
 */
export default function OpenLinkScreen({ linkId }: { linkId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    financeFetch<{ id: string; kind: FinanceVoucherKind }>(`/vouchers/by-link/${encodeURIComponent(linkId)}`)
      .then((found) => active && router.replace(`${FINANCE_KIND_CONFIG[found.kind].path}/${found.id}`))
      .catch((e) => active && setError(financeErrorMessage(e, 'Không mở được phiếu.')));
    return () => {
      active = false;
    };
  }, [linkId, router]);

  if (error) {
    return (
      <div className="p-4">
        <ErrorBanner message={`${error} Có thể phiếu không còn tồn tại hoặc bạn không có quyền xem.`} />
      </div>
    );
  }
  return <div role="status" className="p-8 text-sm text-slate-500">Đang mở phiếu…</div>;
}
