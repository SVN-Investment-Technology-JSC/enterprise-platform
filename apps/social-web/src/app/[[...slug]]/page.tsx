import { SocialScreen } from '@enterprise-platform/feature-social';

/**
 * Mọi đường dẫn dưới `/modules/social` (`/groups/<id>`, `/posts/<id>`, `/search?q=`...) cùng dựng một màn hình;
 * `SocialScreen` tự đọc URL và chuyển trang phía trình duyệt.
 */
export default function Page() {
  return <SocialScreen />;
}
