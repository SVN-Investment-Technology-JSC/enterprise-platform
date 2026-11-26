import type {
  ProcedureGatewayView,
  ProcedureStepView,
} from '@enterprise-platform/contracts-workspace';
import {
  buildFlowLayout,
  skippedOutsideBranches,
  isStepOverdue,
  slaText,
  splitSteps,
  stepCounts,
  stepDisplayState,
} from './procedure-steps-model';

const step = (over: Partial<ProcedureStepView>): ProcedureStepView => ({
  id: 's',
  name: 'Bước',
  order: 1,
  status: 'pending',
  assigneeLabel: 'A',
  ...over,
});

const now = new Date('2026-11-25T10:00:00.000Z');

describe('procedure-steps-model', () => {
  it('orders steps and splits skipped ones', () => {
    const { path, skipped } = splitSteps([
      step({ id: 'c', order: 30 }),
      step({ id: 'x', order: 20, status: 'skipped' }),
      step({ id: 'a', order: 10, status: 'completed' }),
    ]);
    expect(path.map((s) => s.id)).toEqual(['a', 'c']);
    expect(skipped.map((s) => s.id)).toEqual(['x']);
  });

  it('maps display states', () => {
    expect(stepDisplayState('ready')).toBe('current');
    expect(stepDisplayState('completed')).toBe('done');
    expect(stepDisplayState('pending')).toBe('upcoming');
    expect(stepDisplayState('weird' as never)).toBe('upcoming');
  });

  it('counts with server progress, else excludes skipped', () => {
    const steps = [
      step({ status: 'completed' }),
      step({ status: 'skipped' }),
      step({ status: 'active' }),
    ];
    expect(stepCounts({ steps })).toEqual({ done: 1, total: 2 });
    expect(stepCounts({ steps, progress: { completed: 3, total: 5 } })).toEqual(
      { done: 3, total: 5 },
    );
  });

  it('detects overdue only for open steps of a running instance', () => {
    const late = {
      status: 'active' as const,
      slaDueAt: '2026-11-25T08:00:00.000Z',
    };
    expect(isStepOverdue(late, 'running', now)).toBe(true);
    expect(isStepOverdue(late, 'completed', now)).toBe(false);
    expect(
      isStepOverdue({ ...late, status: 'completed' }, 'running', now),
    ).toBe(false);
    expect(isStepOverdue({ status: 'active' }, 'running', now)).toBe(false);
  });

  it('formats SLA text', () => {
    expect(
      slaText(
        { status: 'active', slaDueAt: '2026-11-25T08:00:00.000Z' },
        'running',
        now,
      ),
    ).toBe('Quá hạn 2 giờ');
    expect(
      slaText(
        { status: 'active', slaDueAt: '2026-11-25T13:00:00.000Z' },
        'running',
        now,
      ),
    ).toBe('Còn 3 giờ');
    expect(
      slaText(
        { status: 'pending', slaDueAt: '2026-12-25T13:00:00.000Z' },
        'running',
        now,
      ),
    ).toMatch(/^Hạn \d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(
      slaText(
        { status: 'completed', slaDueAt: '2026-11-25T08:00:00.000Z' },
        'running',
        now,
      ),
    ).toBe('');
  });
});

describe('buildFlowLayout', () => {
  const steps = [
    step({ id: 'a', order: 10, status: 'completed' }),
    step({ id: 'b1', order: 20, status: 'completed' }),
    step({ id: 'b2', order: 30, status: 'active' }),
    step({ id: 'c1', order: 40, status: 'skipped' }),
    step({ id: 'z', order: 50, status: 'pending' }),
    step({ id: 'x', order: 60, status: 'skipped' }),
  ];
  const gateway = (chosenBranchId?: string): ProcedureGatewayView => ({
    id: 'g',
    name: 'Giá trị',
    afterStepId: 'a',
    chosenBranchId,
    branches: [
      { id: 'br1', label: 'Lớn', isDefault: false, stepIds: ['b1', 'b2'] },
      { id: 'br2', label: 'Nhỏ', isDefault: true, stepIds: ['c1'] },
    ],
  });

  it('is identical to a plain path without gateways', () => {
    const layout = buildFlowLayout({ steps });
    expect(layout.map((s) => (s.kind === 'step' ? s.step.id : 'g'))).toEqual([
      'a',
      'b1',
      'b2',
      'z',
    ]);
    expect(buildFlowLayout({ steps, gateways: [] })).toEqual(layout);
  });

  it('puts the gateway after its step and keeps branch steps out of the trunk', () => {
    const layout = buildFlowLayout({ steps, gateways: [gateway('br1')] });
    expect(layout.map((s) => (s.kind === 'step' ? s.step.id : 'g'))).toEqual([
      'a',
      'g',
      'z',
    ]);
    const block = layout[1];
    if (block.kind !== 'gateway') throw new Error('expected gateway');
    expect(block.branches.map((b) => [b.branch.id, b.state])).toEqual([
      ['br1', 'chosen'],
      ['br2', 'not_chosen'],
    ]);
    expect(block.branches[0].steps.map((s) => s.id)).toEqual(['b1', 'b2']);
    expect(block.branches[1].steps.map((s) => s.id)).toEqual(['c1']);
  });

  it('marks branches pending before a decision', () => {
    const layout = buildFlowLayout({ steps, gateways: [gateway()] });
    const block = layout[1];
    if (block.kind !== 'gateway') throw new Error('expected gateway');
    expect(block.branches.map((b) => b.state)).toEqual(['pending', 'pending']);
  });

  it('keeps only branchless skipped steps in the skipped group', () => {
    expect(
      skippedOutsideBranches({ steps, gateways: [gateway('br1')] }).map(
        (s) => s.id,
      ),
    ).toEqual(['x']);
    expect(skippedOutsideBranches({ steps }).map((s) => s.id)).toEqual([
      'c1',
      'x',
    ]);
  });

  it('counts progress ignoring skipped steps', () => {
    expect(stepCounts({ steps })).toEqual({ done: 2, total: 4 });
  });
});
