/** Tên phân hệ theo đường dẫn quay về (`returnTo`), cho dải "xử lý xong sẽ tự quay về"; không nhận ra thì "Trang chủ". */
const RETURN_SOURCE_LABELS: Readonly<Record<string, string>> = {
  crm: 'Bán hàng',
  hrm: 'Nhân sự',
  finance: 'Tài chính',
  inventory: 'Kho',
  maintenance: 'Bảo trì',
  workspace: 'Workspace',
};

export function returnSourceLabel(path: string): string {
  const module = /^\/modules\/([a-z-]+)/.exec(path)?.[1];
  return (module && RETURN_SOURCE_LABELS[module]) || 'Trang chủ';
}
