import { Suspense } from 'react';
import { VoucherListScreen } from '@enterprise-platform/feature-finance';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <VoucherListScreen kind="RECEIPT" />
    </Suspense>
  );
}
