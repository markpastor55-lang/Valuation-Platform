import { DomainError } from '../core/errors.js';
import type { Instant } from '../core/dates.js';
import type { WorkflowContext } from '../workflow/job-workflow.js';
import { VALIDATION_RULES } from './rules.js';
import type {
  Finding,
  ValidationAcknowledgement,
  ValidationContext,
  ValidationResult,
  ValidationRule,
} from './types.js';

/** Runs every rule applicable to the stage and attaches existing acknowledgements to warnings. */
export function runValidation(
  ctx: ValidationContext,
  rules: readonly ValidationRule[] = VALIDATION_RULES,
): ValidationResult {
  const findings: Finding[] = [];
  const evaluated: string[] = [];
  for (const rule of rules) {
    if (!rule.stages.includes(ctx.stage)) continue;
    evaluated.push(rule.code);
    for (const raw of rule.evaluate(ctx)) {
      const acknowledgement = rule.acknowledgeable
        ? ctx.acknowledgements.find((a) => a.code === rule.code && a.path === raw.path)
        : undefined;
      findings.push({
        ...raw,
        code: rule.code,
        title: rule.title,
        category: rule.category,
        severity: rule.severity,
        acknowledgeable: rule.acknowledgeable,
        ...(acknowledgement ? { acknowledgement } : {}),
      });
    }
  }
  return {
    stage: ctx.stage,
    ranAt: ctx.now,
    findings,
    blockingCount: findings.filter((f) => f.severity === 'blocking').length,
    unacknowledgedWarningCount: findings.filter(
      (f) => f.severity === 'warning' && !f.acknowledgement,
    ).length,
    rulesEvaluated: evaluated,
  };
}

export const MIN_ACKNOWLEDGEMENT_REASON = 10;

/** Creates an acknowledgement for a warning finding. Blocking findings cannot be acknowledged. */
export function acknowledgeFinding(
  finding: Finding,
  by: string,
  at: Instant,
  reason: string,
): ValidationAcknowledgement {
  if (!finding.acknowledgeable || finding.severity === 'blocking') {
    throw new DomainError(
      'GUARD_FAILED',
      `${finding.code} is blocking and must be resolved, not acknowledged`,
    );
  }
  if (reason.trim().length < MIN_ACKNOWLEDGEMENT_REASON) {
    throw new DomainError('INVALID_ARGUMENT', 'an acknowledgement needs a reason');
  }
  return { code: finding.code, path: finding.path, by, at, reason: reason.trim() };
}

export const summariseValidation = (
  r: ValidationResult,
): NonNullable<WorkflowContext['validation']> => ({
  blockingCount: r.blockingCount,
  unacknowledgedWarningCount: r.unacknowledgedWarningCount,
});
