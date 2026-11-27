import { VoucherFormScreen } from '@enterprise-platform/feature-finance';

/** Nhân bản phiếu ngay trong popup của phân hệ khác (hồ sơ Quy trình): `?from=<id>` điền sẵn từ phiếu nguồn. */
export default function Page() {
  return <VoucherFormScreen kind="RECEIPT" />;
}
