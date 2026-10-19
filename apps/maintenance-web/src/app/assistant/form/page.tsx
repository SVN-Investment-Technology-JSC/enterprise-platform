import { MaintenanceAssistantFormPage } from '@enterprise-platform/feature-maintenance';

/**
 * Trang form nhúng của Bảo trì cho card Trợ lý (`?key=<thao tác>&rid=<requestId>`); khung chat đặt trang này trong
 * iframe cùng tên miền.
 */
export default function AssistantFormPage() {
  return <MaintenanceAssistantFormPage />;
}
