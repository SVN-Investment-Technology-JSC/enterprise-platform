import {
  autoCompleteParents,
  expectedProgress,
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

describe('autoCompleteParents (WS-U6)', () => {
  it('cha tự hoàn thành khi mọi con đã done', () => {
    const nodes: ProgressNode[] = [
      { id: 'p', parentId: null, status: 'in_progress', progressPercent: 90 },
      { id: 'a', parentId: 'p', status: 'done', progressPercent: 100 },
      { id: 'b', parentId: 'p', status: 'done', progressPercent: 100 },
    ];
    const result = autoCompleteParents(nodes);
    expect(result.has('p')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('cha KHÔNG hoàn thành khi còn con chưa done', () => {
    const nodes: ProgressNode[] = [
      { id: 'p', parentId: null, status: 'in_progress', progressPercent: 50 },
      { id: 'a', parentId: 'p', status: 'done', progressPercent: 100 },
      { id: 'b', parentId: 'p', status: 'in_progress', progressPercent: 40 },
    ];
    expect(autoCompleteParents(nodes).has('p')).toBe(false);
  });

  it('cha đã done rồi thì không nằm trong tập cần flip (không mở lại/không lặp)', () => {
    const nodes: ProgressNode[] = [
      { id: 'p', parentId: null, status: 'done', progressPercent: 100 },
      { id: 'a', parentId: 'p', status: 'done', progressPercent: 100 },
    ];
    expect(autoCompleteParents(nodes).has('p')).toBe(false);
  });

  it('con đã huỷ được bỏ qua: cha xong khi các con còn lại đều done', () => {
    const nodes: ProgressNode[] = [
      { id: 'p', parentId: null, status: 'in_progress', progressPercent: 60 },
      { id: 'a', parentId: 'p', status: 'done', progressPercent: 100 },
      { id: 'b', parentId: 'p', status: 'cancelled', progressPercent: 0 },
    ];
    expect(autoCompleteParents(nodes).has('p')).toBe(true);
  });

  it('cha mà MỌI con đều huỷ thì không tự hoàn thành', () => {
    const nodes: ProgressNode[] = [
      { id: 'p', parentId: null, status: 'in_progress', progressPercent: 0 },
      { id: 'a', parentId: 'p', status: 'cancelled', progressPercent: 0 },
      { id: 'b', parentId: 'p', status: 'cancelled', progressPercent: 0 },
    ];
    // p trở thành "lá hiệu lực" nhưng bản thân chưa done nên không flip.
    expect(autoCompleteParents(nodes).has('p')).toBe(false);
  });

  it('cha đã huỷ không bị ép sang done dù các con đều done', () => {
    const nodes: ProgressNode[] = [
      { id: 'p', parentId: null, status: 'cancelled', progressPercent: 0 },
      { id: 'a', parentId: 'p', status: 'done', progressPercent: 100 },
    ];
    expect(autoCompleteParents(nodes).has('p')).toBe(false);
  });

  it('đệ quy nhiều cấp: ông bà cũng hoàn thành khi toàn cây con done', () => {
    const nodes: ProgressNode[] = [
      { id: 'root', parentId: null, status: 'in_progress', progressPercent: 80 },
      { id: 'mid', parentId: 'root', status: 'in_progress', progressPercent: 90 },
      { id: 'leaf1', parentId: 'mid', status: 'done', progressPercent: 100 },
      { id: 'leaf2', parentId: 'mid', status: 'done', progressPercent: 100 },
    ];
    const result = autoCompleteParents(nodes);
    expect(result.has('mid')).toBe(true);
    expect(result.has('root')).toBe(true);
  });

  it('lá đơn lẻ không có con không bị coi là cha cần flip', () => {
    const nodes: ProgressNode[] = [
      { id: 'solo', parentId: null, status: 'done', progressPercent: 100 },
    ];
    expect(autoCompleteParents(nodes).size).toBe(0);
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

describe('tiến độ nhập tay', () => {
  const tree = (manual?: number): ProgressNode[] => [
    { id: 'p', parentId: null, status: 'in_progress', progressPercent: 50, manualPercent: manual },
    { id: 'a', parentId: 'p', status: 'done', progressPercent: 100 },
    { id: 'b', parentId: 'p', status: 'todo', progressPercent: 0 },
    { id: 'c', parentId: null, status: 'todo', progressPercent: 0 },
  ];

  it('chưa nhập tay thì dự án dùng tiến độ tự tính', () => {
    expect(projectProgress(tree())).toBe(33);
  });

  it('việc cha nhập tay: giữ cột tự tính, nhưng dự án dùng giá trị nhập tay với trọng số cả nhánh', () => {
    const nodes = tree(80);
    expect(rollUpProgress(nodes).size).toBe(0);
    // Nhánh p nặng 2 lá ở mức 80%, việc c nặng 1 lá ở 0%.
    expect(projectProgress(nodes)).toBe(53);
  });

  it('việc lá nhập tay được cuộn lên cha thay cho giá trị cũ', () => {
    const nodes: ProgressNode[] = [
      { id: 'p', parentId: null, status: 'in_progress', progressPercent: 0 },
      { id: 'a', parentId: 'p', status: 'in_progress', progressPercent: 0, manualPercent: 60 },
      { id: 'b', parentId: 'p', status: 'todo', progressPercent: 0 },
    ];
    expect(rollUpProgress(nodes).get('p')).toBe(30);
  });
});

describe('projectProgress theo cách tính của dự án', () => {
  /** Hai công việc gốc, giống ví dụ ở form tạo dự án của 1Office. */
  const roots = (a: Partial<ProgressNode>, b: Partial<ProgressNode>): ProgressNode[] => [
    { id: 'a', parentId: null, status: 'in_progress', progressPercent: 40, ...a },
    { id: 'b', parentId: null, status: 'in_progress', progressPercent: 60, ...b },
  ];

  it('avg_tasks: bình quân % các công việc gốc, bất kể giờ ước lượng', () => {
    // (40 + 60) / 2 = 50. Giờ ước lượng chênh nhau nhiều vẫn không ảnh hưởng.
    const nodes = roots({ estimateHours: 100 }, { estimateHours: 1 });
    expect(projectProgress(nodes, 'avg_tasks')).toBe(50);
    // Công thức cũ thì bị việc 100 giờ kéo gần về 40.
    expect(projectProgress(nodes, 'weighted_hours')).toBe(40);
  });

  it('avg_tasks: nhánh gốc có việc con thì tính một lần, không nhân theo số việc con', () => {
    const nodes: ProgressNode[] = [
      { id: 'p', parentId: null, status: 'in_progress', progressPercent: 0 },
      { id: 'p1', parentId: 'p', status: 'done', progressPercent: 100 },
      { id: 'p2', parentId: 'p', status: 'done', progressPercent: 100 },
      { id: 'p3', parentId: 'p', status: 'done', progressPercent: 100 },
      { id: 'q', parentId: null, status: 'todo', progressPercent: 0 },
    ];
    // p = 100, q = 0 → 50. Tính theo lá thì ra 75.
    expect(projectProgress(nodes, 'avg_tasks')).toBe(50);
    expect(projectProgress(nodes, 'weighted_hours')).toBe(75);
  });

  it('avg_tasks: việc gốc đã huỷ bị loại khỏi phép tính', () => {
    const nodes = roots({ progressPercent: 100 }, { status: 'cancelled', progressPercent: 0 });
    expect(projectProgress(nodes, 'avg_tasks')).toBe(100);
  });

  it('weighted_days: ví dụ của 1Office, 4 ngày 40% và 6 ngày 50% ra 46%', () => {
    const nodes = roots(
      { progressPercent: 40, plannedStart: '2026-11-02', plannedEnd: '2026-11-05' },
      { progressPercent: 50, plannedStart: '2026-11-02', plannedEnd: '2026-11-07' },
    );
    // (4*40 + 6*50) / 10 = 46.
    expect(projectProgress(nodes, 'weighted_days')).toBe(46);
  });

  it('weighted_days: việc thiếu ngày nặng bằng trung bình các việc có ngày', () => {
    const nodes = roots(
      { progressPercent: 100, plannedStart: '2026-11-02', plannedEnd: '2026-11-05' },
      { progressPercent: 0 },
    );
    // Việc b nặng bằng 4 (trung bình của mỗi mình a): (100*4 + 0*4) / 8 = 50.
    expect(projectProgress(nodes, 'weighted_days')).toBe(50);
  });

  it('weighted_days: không việc nào có ngày thì chia đều', () => {
    expect(projectProgress(roots({}, {}), 'weighted_days')).toBe(50);
  });

  it('weighted_weight: ví dụ của 1Office, tỷ trọng 40 ở 50% và 30 ở 40% ra 46%', () => {
    const nodes = roots({ progressPercent: 50, weight: 40 }, { progressPercent: 40, weight: 30 });
    // [(40*50) + (30*40)] / (40+30) = 45,71 → 46.
    expect(projectProgress(nodes, 'weighted_weight')).toBe(46);
  });

  it('weighted_weight: việc chưa đặt tỷ trọng nặng bằng trung bình các việc đã đặt', () => {
    const nodes = roots({ progressPercent: 100, weight: 30 }, { progressPercent: 0, weight: null });
    expect(projectProgress(nodes, 'weighted_weight')).toBe(50);
  });

  it('weighted_weight: tỷ trọng 0 không đóng góp; mọi tỷ trọng 0 thì quay về bình quân thường', () => {
    const one = roots({ progressPercent: 100, weight: 0 }, { progressPercent: 20, weight: 10 });
    expect(projectProgress(one, 'weighted_weight')).toBe(20);
    const all = roots({ progressPercent: 100, weight: 0 }, { progressPercent: 20, weight: 0 });
    expect(projectProgress(all, 'weighted_weight')).toBe(60);
  });

  it('weighted_weight: chỉ công việc gốc được tính tỷ trọng, việc con bỏ qua tỷ trọng của chính nó', () => {
    const nodes: ProgressNode[] = [
      { id: 'a', parentId: null, status: 'in_progress', progressPercent: 0, weight: 1 },
      { id: 'a1', parentId: 'a', status: 'done', progressPercent: 100, weight: 99 },
      { id: 'a2', parentId: 'a', status: 'todo', progressPercent: 0, weight: 1 },
      { id: 'b', parentId: null, status: 'todo', progressPercent: 0, weight: 1 },
    ];
    // a = bình quân hai việc con = 50 (không theo tỷ trọng con); (50*1 + 0*1)/2 = 25.
    expect(projectProgress(nodes, 'weighted_weight')).toBe(25);
  });

  it('mặc định giữ công thức cũ (weighted_hours) để dự án có sẵn không đổi số liệu', () => {
    const nodes = roots({ estimateHours: 30 }, { estimateHours: 10 });
    expect(projectProgress(nodes)).toBe(projectProgress(nodes, 'weighted_hours'));
    // (40*30 + 60*10) / 40 = 45.
    expect(projectProgress(nodes)).toBe(45);
  });
});

describe('expectedProgress (tiến độ dự kiến theo thời gian)', () => {
  it('khớp 1Office: 20/10/2026 – 31/01/2027 vào ngày 15/11/2026 là 25%', () => {
    expect(expectedProgress('2026-10-20', '2027-01-31', '2026-11-15')).toBe(25);
  });

  it('trước ngày bắt đầu là 0%, sau ngày kết thúc là 100%', () => {
    expect(expectedProgress('2026-11-10', '2026-11-20', '2026-11-01')).toBe(0);
    expect(expectedProgress('2026-11-10', '2026-11-20', '2026-11-21')).toBe(100);
  });

  it('đúng ngày bắt đầu là 0%, đúng ngày kết thúc chưa tới 100% (còn tính cả ngày đó)', () => {
    expect(expectedProgress('2026-11-10', '2026-11-19', '2026-11-10')).toBe(0);
    expect(expectedProgress('2026-11-10', '2026-11-19', '2026-11-19')).toBe(90);
  });

  it('khoảng một ngày: trong ngày đó là 0%, sang hôm sau là 100%', () => {
    expect(expectedProgress('2026-10-23', '2026-10-23', '2026-10-23')).toBe(0);
    expect(expectedProgress('2026-10-23', '2026-10-23', '2026-10-24')).toBe(100);
  });

  it('thiếu ngày hoặc ngày kết thúc trước ngày bắt đầu thì không xác định', () => {
    expect(expectedProgress(undefined, '2026-11-20', '2026-11-15')).toBeUndefined();
    expect(expectedProgress('2026-11-10', null, '2026-11-15')).toBeUndefined();
    expect(expectedProgress('2026-11-20', '2026-11-10', '2026-11-15')).toBeUndefined();
    expect(expectedProgress('không phải ngày', '2026-11-10', '2026-11-15')).toBeUndefined();
  });
});

describe('rollUpProgress theo tỷ trọng việc con (child_weight)', () => {
  const tree = (parent: Partial<ProgressNode>, a: Partial<ProgressNode>, b: Partial<ProgressNode>): ProgressNode[] => [
    { id: 'p', parentId: null, status: 'in_progress', progressPercent: 0, method: 'child_weight', ...parent },
    { id: 'a', parentId: 'p', status: 'in_progress', progressPercent: 100, ...a },
    { id: 'b', parentId: 'p', status: 'in_progress', progressPercent: 0, ...b },
  ];

  it('mặc định chia đều, bỏ qua tỷ trọng và giờ ước lượng của con', () => {
    const nodes = tree({}, { weight: 90, estimateHours: 100 }, { weight: 10, estimateHours: 1 });
    expect(rollUpProgress(nodes).get('p')).toBe(50);
  });

  it('không chia đều: theo tỷ trọng của con', () => {
    const nodes = tree({ equalChildWeight: false }, { weight: 30 }, { weight: 10 });
    // (100*30 + 0*10) / 40 = 75
    expect(rollUpProgress(nodes).get('p')).toBe(75);
  });

  it('con chưa đặt tỷ trọng nặng bằng trung bình các con đã đặt', () => {
    const nodes = tree({ equalChildWeight: false }, { weight: 30 }, { weight: null });
    // b nặng 30: (100*30 + 0*30) / 60 = 50
    expect(rollUpProgress(nodes).get('p')).toBe(50);
  });

  it('mọi tỷ trọng bằng 0: quay về bình quân thường, không kẹt ở 0%', () => {
    const nodes = tree({ equalChildWeight: false }, { weight: 0 }, { weight: 0 });
    expect(rollUpProgress(nodes).get('p')).toBe(50);
  });

  it('việc con đã huỷ bị loại', () => {
    const nodes = tree({}, { progressPercent: 100 }, { status: 'cancelled' });
    expect(rollUpProgress(nodes).get('p')).toBe(100);
  });

  it('cha không đặt cách này vẫn tính theo giờ ước lượng như cũ', () => {
    const nodes = tree({ method: 'manual' }, { estimateHours: 30 }, { estimateHours: 10 });
    expect(rollUpProgress(nodes).get('p')).toBe(75);
  });
});

describe('trọng số của nhánh tính theo tỷ trọng việc con khi cuộn lên dự án', () => {
  it('giữ thang giờ ước lượng: nhánh child_weight không bị tính nhẹ đi so với việc cùng cấp', () => {
    const nodes: ProgressNode[] = [
      { id: 'p', parentId: null, status: 'in_progress', progressPercent: 0, method: 'child_weight' },
      { id: 'a', parentId: 'p', status: 'in_progress', progressPercent: 50, estimateHours: 40 },
      { id: 'b', parentId: 'p', status: 'in_progress', progressPercent: 50, estimateHours: 40 },
      { id: 'q', parentId: null, status: 'todo', progressPercent: 0, estimateHours: 40 },
    ];
    // Nhánh p nặng 80 giờ (không phải 2 theo số con): (50*80 + 0*40) / 120 = 33.
    expect(projectProgress(nodes, 'weighted_hours')).toBe(33);
  });
});
