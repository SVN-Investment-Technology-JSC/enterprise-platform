'use client';

import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import styles from './workspace-board.module.scss';

const STATUS_LABEL: Record<ProcedureInstance['status'], string> = {
  running: 'Đang xử lý',
  completed: 'Hoàn thành',
  rejected: 'Từ chối',
  cancelled: 'Đã huỷ',
};

/**
 * Hồ sơ sinh ra từ hồ sơ này.
 *
 * Chia làm hai loại vì chúng có ý nghĩa khác hẳn nhau:
 *
 *  - **Nhánh rẽ** — đơn xin vật tư (mượn/xuất, mua sắm). Chúng chạy SONG SONG
 *    với hồ sơ mẹ; hồ sơ mẹ vẫn đứng ở bước của nó và chờ hàng về.
 *  - **Nối tiếp** — quy trình gắn vào một bước, mở ra khi bước đó xong. Chúng
 *    chạy SAU, là phần tiếp theo của cùng một mạch công việc.
 *
 * Gộp chung một danh sách sẽ khiến người đọc tưởng đơn mua hàng là bước kế tiếp
 * của quy trình bảo trì, trong khi thực tế nó là một nhánh chờ ở bên cạnh.
 */
export function LinkedPanel({
  instance,
  instances,
  onOpen,
}: {
  instance: ProcedureInstance;
  /** Toàn bộ hồ sơ đang nhìn thấy, để tìm con theo `sourceId`. */
  instances: readonly ProcedureInstance[];
  onOpen: (instanceId: string) => void;
}) {
  const children = instances.filter(
    (candidate) => candidate.sourceId === instance.id && candidate.id !== instance.id,
  );

  /**
   * Đơn vật tư nhận ra qua nhật ký của hồ sơ mẹ: chính chỗ mở đơn đã ghi lại mã
   * hồ sơ con. Không dựa vào tên quy trình — tên do tenant tự đặt, so khớp chuỗi
   * là hỏng ngay khi ai đó đổi tên.
   */
  const materialCodes = new Set(
    instance.activity
      .filter((entry) => entry.summary.includes('mượn/xuất kho') || entry.summary.includes('mua sắm'))
      .flatMap((entry) => entry.summary.match(/PR-\d{8}-[A-Z0-9]+/g) ?? []),
  );

  const branches = children.filter((child) => materialCodes.has(child.code));
  const sequential = children.filter((child) => !materialCodes.has(child.code));

  /**
   * Hồ sơ MẸ — hồ sơ đã mở ra hồ sơ này.
   *
   * Đây là chiều ngược lại và cũng cần thiết như chiều xuôi: đứng ở một đơn mua
   * sắm, câu hỏi đầu tiên là "mua cho việc gì". Không có đường lên thì người
   * duyệt phải đi tìm bằng tay trong danh sách hồ sơ.
   */
  const parent = instance.sourceId
    ? instances.find((candidate) => candidate.id === instance.sourceId)
    : undefined;

  // Không liên quan tới hồ sơ nào thì không chiếm chỗ: khối này nằm thẳng trong
  // chi tiết chứ không sau tab, nên một dòng "chưa có gì" sẽ đẩy nội dung thật
  // xuống.
  if (children.length === 0 && !parent) return null;

  return (
    <article className={styles.linkedWrap}>
      <h3 className={styles.panelTitle}>Hồ sơ liên quan</h3>

      {parent ? (
        <Group
          title="Mở từ hồ sơ"
          hint="Hồ sơ đã sinh ra hồ sơ này. Xong việc ở đây thì quay lại đó để tiếp tục."
          items={[parent]}
          onOpen={onOpen}
        />
      ) : null}

      {branches.length > 0 ? (
        <Group
          title="Nhánh rẽ — đơn vật tư"
          hint="Chạy song song. Hồ sơ này vẫn đứng ở bước hiện tại và chờ hàng về."
          items={branches}
          onOpen={onOpen}
        />
      ) : null}

      {sequential.length > 0 ? (
        <Group
          title="Nối tiếp"
          hint="Mở ra khi bước gắn kèm đã xong; là phần tiếp theo của cùng mạch công việc."
          items={sequential}
          onOpen={onOpen}
          ordered
        />
      ) : null}
    </article>
  );
}

function Group(props: {
  title: string;
  hint: string;
  items: readonly ProcedureInstance[];
  onOpen: (instanceId: string) => void;
  /** Nối tiếp thì đánh số để thấy rõ thứ tự; nhánh rẽ thì không có thứ tự nào. */
  ordered?: boolean;
}) {
  const items = props.ordered
    ? [...props.items].sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    : props.items;

  return (
    <section className={styles.linkedGroup}>
      <header>
        <h4>{props.title}</h4>
        <span className={styles.stepBadge}>{items.length}</span>
      </header>
      <p className={styles.panelHint}>{props.hint}</p>
      <ol className={props.ordered ? styles.linkedOrdered : styles.linkedList}>
        {items.map((child, index) => (
          <li key={child.id}>
            {props.ordered ? <span className={styles.linkedIndex}>{index + 1}</span> : null}
            <button type="button" className={styles.linkedItem} onClick={() => props.onOpen(child.id)}>
              <span className={styles.linkedCode}>{child.code}</span>
              <span className={styles.linkedTitle}>{child.title}</span>
              <span className={styles.linkedStatus}>{STATUS_LABEL[child.status]}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
