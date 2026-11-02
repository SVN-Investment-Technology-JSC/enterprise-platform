import { buildPipeline } from '../domain/pipeline-fixture.js';
import { assertOutcomeStages, validateRequirements, validateTransitionTargets } from '../domain/pipeline-config.js';
import { PIPELINE_TEMPLATES, blankPipelineTemplate } from './pipeline-templates.js';

const DOC_CODES = new Set(['LEGAL_DOSSIER', 'ESTIMATE', 'BUSINESS_PLAN']);

  describe('mẫu luồng', () => {
    const templates = [...PIPELINE_TEMPLATES, blankPipelineTemplate('STANDARD'), blankPipelineTemplate('TENDER')];
    it('có ba mẫu: bán hàng đơn giản, có PAKD, chào thầu', () => {
      expect(PIPELINE_TEMPLATES.map((t) => t.id)).toEqual(['SALES_SIMPLE', 'SALES_WITH_BUSINESS_PLAN', 'TENDER']);
      expect(PIPELINE_TEMPLATES.map((t) => t.profile)).toEqual(['STANDARD', 'STANDARD', 'TENDER']);
    });
    it.each(templates.map((t) => [t.id + ':' + t.profile, t] as const))('mẫu %s thoả mọi quy tắc cấu hình', (_name, template) => {
      const pipeline = buildPipeline({
        code: 'T',
        profile: template.profile,
        stages: template.stages.map((s) => ({ code: s.code, name: s.name, semantic: s.semantic })),
        transitions: template.transitions as [string, string][],
      });
      expect(() => assertOutcomeStages(template.name, pipeline.stages)).not.toThrow();
      for (const s of pipeline.stages) {
        const targets = pipeline.stages.filter((to) => template.transitions.some(([f, t]) => f === s.code && t === to.code));
        expect(() => validateTransitionTargets(pipeline, s, targets.map((to) => to.id))).not.toThrow();
      }
      for (const s of template.stages) {
        const mine = template.requirements.filter((r) => r.stageCode === s.code);
        expect(() => validateRequirements(mine, template.profile, DOC_CODES)).not.toThrow();
      }
      expect(new Set(template.stages.map((s) => s.code)).size).toBe(template.stages.length);
      expect(template.requirements.every((r) => template.stages.some((s) => s.code === r.stageCode))).toBe(true);
    });
  });
