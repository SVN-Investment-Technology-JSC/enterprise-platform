import { VoucherDetailScreen } from '@enterprise-platform/feature-finance';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VoucherDetailScreen kind="RECEIPT" id={id} />;
}
