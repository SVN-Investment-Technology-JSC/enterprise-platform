'use client';

import type {
  CreateProcedureDefinitionRequest,
  ProcedureDefinition,
} from '@enterprise-platform/contracts-procedure-engine';
import { useState, type FormEvent } from 'react';
import styles from './procedure-engine.module.scss';

interface DefinitionBoardProps {
  actor: { id: string; name: string };
  busy?: string;
  definitions: ProcedureDefinition[];
  onCreate: (input: CreateProcedureDefinitionRequest) => Promise<void>;
  onPublish: (definitionId: string) => Promise<void>;
  onStart: (definition: ProcedureDefinition) => Promise<void>;
}

export function DefinitionBoard({
  actor,
  busy,
  definitions,
  onCreate,
  onPublish,
  onStart,
}: DefinitionBoardProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [stepNames, setStepNames] = useState(
    'Lập đề nghị\nKiểm tra\nPhê duyệt',
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const names = stepNames
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
    const userId = actor.id;
    const input: CreateProcedureDefinitionRequest = {
      code,
      name,
      description,
      kind: 'process',
      steps: names.map((stepName, index) => {
        const isFirst = index === 0;
        const isLast = index === names.length - 1;
        return {
          key: `STEP_${index + 1}`,
          order: index + 1,
          name: stepName,
          assignments: [
            ...(isFirst
              ? ([
                  {
                    role: 'S' as const,
                    subjectType: 'user' as const,
                    subjectId: userId,
                    subjectLabel: actor.name,
                  },
                ] as const)
              : []),
            ...(!isLast
              ? ([
                  {
                    role: 'R' as const,
                    subjectType: 'user' as const,
                    subjectId: userId,
                    subjectLabel: actor.name,
                  },
                ] as const)
              : []),
            ...(isLast
              ? ([
                  {
                    role: 'A' as const,
                    subjectType: 'user' as const,
                    subjectId: userId,
                    subjectLabel: actor.name,
                  },
                ] as const)
              : []),
          ],
        };
      }),
    };
    await onCreate(input);
    setCode('');
    setName('');
    setDescription('');
    setShowCreate(false);
  };

  return (
    <section className={styles.content}>
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>Ma trận RCSI theo phiên bản</span>
          <h2>Quy trình doanh nghiệp</h2>
          <p>
            Bản công bố là bất biến. Mỗi bước chạy tuần tự qua S → R → E → C → A
            theo các vai trò thật sự được cấu hình.
          </p>
        </div>
        <button
          className={styles.primaryButton}
          onClick={() => setShowCreate((value) => !value)}
          type="button"
        >
          {showCreate ? 'Đóng biểu mẫu' : '+ Tạo bản nháp'}
        </button>
      </div>

      {showCreate ? (
        <form
          className={styles.createForm}
          onSubmit={(event) => void submit(event)}
        >
          <div>
            <label htmlFor="procedure-code">Mã quy trình</label>
            <input
              id="procedure-code"
              onChange={(event) => setCode(event.currentTarget.value)}
              placeholder="PROC-PURCHASE"
              required
              value={code}
            />
          </div>
          <div>
            <label htmlFor="procedure-name">Tên quy trình</label>
            <input
              id="procedure-name"
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Đề nghị mua sắm"
              required
              value={name}
            />
          </div>
          <div className={styles.fullField}>
            <label htmlFor="procedure-description">Mô tả</label>
            <input
              id="procedure-description"
              onChange={(event) => setDescription(event.currentTarget.value)}
              placeholder="Mục đích và phạm vi áp dụng"
              value={description}
            />
          </div>
          <div className={styles.fullField}>
            <label htmlFor="procedure-steps">
              Các bước (mỗi dòng một bước)
            </label>
            <textarea
              id="procedure-steps"
              onChange={(event) => setStepNames(event.currentTarget.value)}
              required
              rows={4}
              value={stepNames}
            />
            <small>
              Form đầu tiên tự gán S/R/A cho tài khoản phát triển; matrix editor
              và subject picker từ Platform sẽ là lát cắt kế tiếp.
            </small>
          </div>
          <button
            className={styles.primaryButton}
            disabled={busy === 'create-definition'}
            type="submit"
          >
            {busy === 'create-definition' ? 'Đang tạo…' : 'Tạo bản nháp'}
          </button>
        </form>
      ) : null}

      <div className={styles.definitionList}>
        {definitions.map((definition) => (
          <article className={styles.definitionCard} key={definition.id}>
            <header>
              <div>
                <span className={styles.code}>{definition.code}</span>
                <h3>{definition.name}</h3>
                <p>{definition.description || 'Chưa có mô tả.'}</p>
              </div>
              <span className={`${styles.status} ${styles[definition.status]}`}>
                {definition.status === 'published' ? 'Đã công bố' : 'Bản nháp'}
              </span>
            </header>

            <div className={styles.stepRail}>
              {definition.steps.map((step) => (
                <div className={styles.definitionStep} key={step.id}>
                  <span className={styles.stepNumber}>{step.order}</span>
                  <div>
                    <strong>{step.name}</strong>
                    <small>{step.key}</small>
                    <div
                      className={styles.roles}
                      aria-label={`Vai trò tại ${step.name}`}
                    >
                      {step.assignments.map((assignment) => (
                        <span
                          className={`${styles.role} ${styles[`role${assignment.role}`]}`}
                          key={assignment.id}
                          title={
                            assignment.subjectLabel || assignment.subjectId
                          }
                        >
                          {assignment.role}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <footer>
              <span>
                v{definition.versionNumber || 'draft'} ·{' '}
                {definition.steps.length} bước
              </span>
              <div>
                {definition.status === 'draft' ? (
                  <button
                    className={styles.secondaryButton}
                    disabled={busy === `publish:${definition.id}`}
                    onClick={() => void onPublish(definition.id)}
                    type="button"
                  >
                    {busy === `publish:${definition.id}`
                      ? 'Đang công bố…'
                      : 'Công bố'}
                  </button>
                ) : (
                  <button
                    className={styles.primaryButton}
                    disabled={busy === `start:${definition.id}`}
                    onClick={() => void onStart(definition)}
                    type="button"
                  >
                    Khởi tạo hồ sơ
                  </button>
                )}
              </div>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
