import {
  isClosed,
  isOverdue,
  projectProgress,
  rollUpProgress,
  type ProgressNode,
} from './progress.rules.js';

describe('rollUpProgress', () => {
  it('bình quân có trọng số theo giờ ước lượng', () => {
    // Nhánh 'p' có hai lá: 10 giờ đạt 100%, 30 giờ đạt 0%.
    // Kỳ vọng (100*10 + 0*30) / 40 = 25, không phải 50 như bình quân thường.
    const nodes: ProgressNode[] = [
      { id: 'p', parentId: null, status: 'in_progress', progressPercent: 0 },
      { id: 'a', parentId: 'p', status: 'done', progressPercent: 100, estimateHours: 10 },
      { id: 'b', parentId: 'p', status: 'todo', progressPercent: 0, estimateHours: 30 },
    ];
    expect(rollUpProgress(nodes).get('p')).toBe(25);
  });

  it('không việc nào có ước lượng thì mọi việc nặng như nhau', () => {
    const nodes: ProgressNode[] = [
      { id: 'p', parentId: null, status: 'in_progress', progressPercent: 0 },
      { id: 'a', parentId: 'p', status: 'done', progressPercent: 100 },
      { id: 'b', parentId: 'p', status: 'todo', progressPercent: 0 },
    ];
    expect(rollUpProgress(nodes).get('p')).toBe(50);
  });

  it('việc thiếu ước lượng nặng bằng trung bình các việc có ước lượng', () => {
    // Trung bình ước lượng = (80 + 64) / 2 = 72, nên 'c' cũng nặng 72.
    // (100*80 + 100*64 + 0*72) / 216 = 67 — không phải 99 như trọng số 1.
    const nodes: ProgressNode[] = [
      { id: 'p', parentId: null, status: 'in_progress', progressPercent: 0 },
      { id: 'a', parentId: 'p', status: 'done', progressPercent: 100, estimateHours: 80 },
      { id: 'b', parentId: 'p', status: 'done', progressPercent: 100, estimateHours: 64 },
      { id: 'c', parentId: 'p', status: 'todo', progressPercent: 0 },
    ];
    expect(rollUpProgress(nodes).get('p')).toBe(67);
  });

  it('bỏ việc đã huỷ ra khỏi phép tính', () => {
    // Nếu tính cả việc huỷ thì ra 50; bỏ ra phải là 100.
    const nodes: ProgressNode[] = [
      { id: 'p', parentId: null, status: 'in_progress', progressPercent: 0 },
      { id: 'a', parentId: 'p', status: 'done', progressPercent: 100 },
      { id: 'b', parentId: 'p', status: 'cancelled', progressPercent: 0 },
    ];
    expect(rollUpProgress(nodes).get('p')).toBe(100);
  });

  it('nhánh sâu mang theo tổng trọng số của lá bên dưới', () => {
    // 'root' có một nhánh 2 lá (10 giờ + 30 giờ) và một lá lẻ 10 giờ.
    //   branch = (100*10 + 0*30) / 40 = 25, và mang trọng số 40.
    //   root   = (25*40 + 0*10) / 50 = 20.
    // Nếu mỗi con trực tiếp được tính trọng số bằng nhau thì root sẽ ra
    // (25 + 0) / 2 = 13 — sai, vì nhánh kia gánh gấp bốn lần khối lượng.
    const nodes: ProgressNode[] = [
      { id: 'root', parentId: null, status: 'in_progress', progressPercent: 0 },
      { id: 'branch', parentId: 'root', status: 'in_progress', progressPercent: 0 },
      { id: 'l1', parentId: 'branch', status: 'done', progressPercent: 100, estimateHours: 10 },
      { id: 'l2', parentId: 'branch', status: 'todo', progressPercent: 0, estimateHours: 30 },
      { id: 'l3', parentId: 'root', status: 'todo', progressPercent: 0, estimateHours: 10 },
    ];
    const changed = rollUpProgress(nodes);
    expect(changed.get('branch')).toBe(25);
    expect(changed.get('root')).toBe(20);
  });

  it('chỉ trả về node thật sự đổi giá trị', () => {
    const nodes: ProgressNode[] = [
      { id: 'p', parentId: null, status: 'in_progress', progressPercent: 50 },
      { id: 'a', parentId: 'p', status: 'done', progressPercent: 100 },
      { id: 'b', parentId: 'p', status: 'todo', progressPercent: 0 },
    ];
    // 'p' đã đúng 50 sẵn nên không được nằm trong danh sách cần cập nhật.
    expect(rollUpProgress(nodes).has('p')).toBe(false);
  });

  it('node lá không bị đưa vào danh sách thay đổi', () => {
    const nodes: ProgressNode[] = [
      { id: 'only', parentId: null, status: 'todo', progressPercent: 0 },
    ];
    expect(rollUpProgress(nodes).size).toBe(0);
  });
});

describe('projectProgress', () => {
  it('bình quân trên toàn bộ lá, không phụ thuộc số nhánh gốc', () => {
    const nodes: ProgressNode[] = [
      { id: 'r1', parentId: null, status: 'in_progress', progressPercent: 0 },
      { id: 'a', parentId: 'r1', status: 'done', progressPercent: 100, estimateHours: 10 },
      { id: 'b', parentId: 'r1', status: 'todo', progressPercent: 0, estimateHours: 10 },
      { id: 'r2', parentId: null, status: 'done', progressPercent: 100, estimateHours: 20 },
    ];
    // Lá là a, b, r2 → (100*10 + 0*10 + 100*20) / 40 = 75.
    expect(projectProgress(nodes)).toBe(75);
  });

  it('hai việc lớn đã xong không kéo dự án gần 100% khi phần lớn chưa làm', () => {
    // Đúng ca go-live: 2 việc 80 + 64 giờ đã xong, 13 việc không ước lượng
    // chưa làm. Trọng số 1 cho ra 98%; trọng số trung bình (72) cho ra
    // 144*100 / (144 + 13*72) = 13%.
    const nodes: ProgressNode[] = [
      { id: 'a', parentId: null, status: 'done', progressPercent: 100, estimateHours: 80 },
      { id: 'b', parentId: null, status: 'done', progressPercent: 100, estimateHours: 64 },
      ...Array.from({ length: 13 }, (_, index): ProgressNode => ({
        id: `t${index}`,
        parentId: null,
        status: 'todo',
        progressPercent: 0,
      })),
    ];
    expect(projectProgress(nodes)).toBe(13);
  });

  it('dự án chưa có công việc thì bằng 0', () => {
    expect(projectProgress([])).toBe(0);
  });
});

describe('isClosed', () => {
  it('done và cancelled là trạng thái đóng', () => {
    expect(isClosed('done')).toBe(true);
    expect(isClosed('cancelled')).toBe(true);
  });

  it('blocked và review vẫn là đang mở', () => {
    expect(isClosed('blocked')).toBe(false);
    expect(isClosed('review')).toBe(false);
  });
});

describe('isOverdue', () => {
  const today = '2026-09-21';

  it('việc đang mở và quá hạn thì tính là quá hạn', () => {
    expect(isOverdue({ status: 'in_progress', plannedEnd: '2026-09-20' }, today)).toBe(true);
  });

  it('việc đóng muộn KHÔNG tính là quá hạn', () => {
    expect(isOverdue({ status: 'done', plannedEnd: '2026-09-01' }, today)).toBe(false);
  });

  it('việc không có hạn thì không bao giờ quá hạn', () => {
    expect(isOverdue({ status: 'todo' }, today)).toBe(false);
  });

  it('hạn đúng hôm nay thì chưa quá hạn', () => {
    expect(isOverdue({ status: 'todo', plannedEnd: today }, today)).toBe(false);
  });
});
