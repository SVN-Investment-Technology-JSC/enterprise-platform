import { VoucherFormScreen } from '@enterprise-platform/feature-finance';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VoucherFormScreen kind="RECEIPT" id={id} />;
}
