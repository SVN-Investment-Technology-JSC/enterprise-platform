import { EditorScreen } from '../editor-screen';

/** Trình thiết kế icon. `iconId` là mã icon trong thư viện, hoặc `new` để vẽ icon mới. */
export default async function PlatformBrandIconEditorPage({ params }: { params: Promise<{ iconId: string }> }) {
  const { iconId } = await params;
  let id = iconId;
  try {
    id = decodeURIComponent(iconId);
  } catch {
    // Mã không giải mã được thì dùng nguyên chuỗi; thư viện sẽ báo không tìm thấy icon.
  }
  return <EditorScreen iconId={id} />;
}
