import { VoucherDetailScreen } from '@enterprise-platform/feature-finance';

/** Phiếu hiện trong popup của phân hệ khác (hồ sơ Quy trình): cùng màn hình, không thanh bên. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VoucherDetailScreen kind="PAYMENT" id={id} />;
}
