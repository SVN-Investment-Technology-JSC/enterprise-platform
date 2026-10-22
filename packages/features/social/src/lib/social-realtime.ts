import { sendRealtime, subscribeRealtimeStatus } from '@enterprise-platform/shared-ui';
import { useEffect } from 'react';

/**
 * Vào phòng tín hiệu realtime của một nhóm khi mở nhóm, rời khi đổi nhóm hoặc đóng màn hình.
 *
 * Máy chủ (realtime-api) hỏi social-api xem người dùng có phải thành viên không rồi mới cho vào, nên bài của
 * nhóm riêng tư chỉ tới thành viên. Phòng mất khi socket nối lại không khôi phục được, nên hook xin vào lại mỗi
 * lần trạng thái kết nối báo `true`; xin vào lặp lại là vô hại (máy chủ coi như đã ở trong phòng).
 *
 * Không có `groupId` (Tường công ty) thì không làm gì: bài của Tường công ty gửi cả phòng của công ty.
 */
export function useSocialGroupRoom(groupId?: string): void {
  useEffect(() => {
    if (!groupId) return undefined;
    const join = () => {
      sendRealtime('social.subscribe', { groupId });
    };
    join();
    const offStatus = subscribeRealtimeStatus((connected) => {
      if (connected) join();
    });
    return () => {
      offStatus();
      sendRealtime('social.unsubscribe', { groupId });
    };
  }, [groupId]);
}
