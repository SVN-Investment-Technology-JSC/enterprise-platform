'use client';

import { AssistantFormHost } from '@enterprise-platform/feature-module-shell';
import { useEffect, useState } from 'react';
import { assistantUnavailableReason } from './assistant-drafts';
import { WorkspaceAssistantForms } from './components/assistant-forms';
import { loadCurrentUserId, loadWorkspaceStatus, type WorkspaceStatus } from './workspace-api';

interface PageContext {
  readonly currentUserId: string;
  readonly status?: WorkspaceStatus;
}

/**
 * Trang form nhúng của Workspace (`/modules/workspace/assistant/form?key=<thao tác>&rid=<requestId>`), trang mà card
 * trong khung chat Trợ lý đặt trong iframe cùng tên miền.
 *
 * Chỉ có form tạo của phân hệ (cuộc họp hoặc sự kiện, công việc trong dự án, việc ngoài dự án), hiện ngay tại chỗ, không
 * vỏ ModuleShell. Thao tác chỉ được đăng ký sau khi biết người đang đăng nhập và trạng thái Workspace (bản nháp đến
 * trước đó được `AssistantFormHost` giữ lại): form mở ra đã chọn sẵn người phụ trách là chính người dùng, và card nhận
 * `unavailable` ngay khi người dùng chưa tạo được gì.
 */
export function WorkspaceAssistantFormPage() {
  const [context, setContext] = useState<PageContext>();

  useEffect(() => {
    let alive = true;
    void Promise.all([
      loadCurrentUserId(),
      // Không đọc được trạng thái thì vẫn mở form như màn hình chính; server kiểm quyền và dữ liệu khi lưu.
      loadWorkspaceStatus().catch(() => undefined),
    ]).then(([currentUserId, status]) => {
      if (alive) setContext({ currentUserId, status });
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <AssistantFormHost>
      {context ? (
        <WorkspaceAssistantForms
          currentUserId={context.currentUserId}
          unavailableMessage={assistantUnavailableReason(context.status)}
        />
      ) : null}
    </AssistantFormHost>
  );
}
