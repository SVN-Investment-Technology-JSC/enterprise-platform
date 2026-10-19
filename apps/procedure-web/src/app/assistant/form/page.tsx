import { ProcedureAssistantFormPage } from '@enterprise-platform/feature-procedure-engine';

/**
 * Trang form nhúng của Quy trình cho card Trợ lý (`?key=<thao tác>&rid=<requestId>`); khung chat đặt trang này trong
 * iframe cùng tên miền.
 */
export default function AssistantFormPage() {
  return <ProcedureAssistantFormPage />;
}
