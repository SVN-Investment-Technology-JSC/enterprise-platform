import { OpenLinkScreen } from '@enterprise-platform/feature-finance';

export default async function Page({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  return <OpenLinkScreen linkId={linkId} />;
}
