/**
 * Versioning policy regression guards (audit_report-2 P1-7)
 *
 * The product's versioning surface is intentionally narrow:
 *
 *   - `seat_map_versions`     ← immutable seat-map snapshots
 *   - `question_explanations` ← explanation history
 *
 * Everything else (question_options, attempt_answers, papers,
 * attempts) is explicitly NOT version-tracked. See
 * `docs/questions.md` §21 for the rationale and decision record.
 *
 * These tests assert the policy at the entity-metadata layer so that
 * any future change that adds a `version_number` column to a non-
 * versioned entity (or removes one from a versioned entity) trips a
 * red unit test before the change can land.
 *
 * The test reads TypeORM's metadata storage rather than touching the
 * database, so it stays in the unit suite — no Postgres needed.
 */
import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';

import { SeatMapVersion } from '../src/rooms/entities/seat-map-version.entity';
import { QuestionExplanation } from '../src/questions/entities/question-explanation.entity';
import { QuestionOption } from '../src/questions/entities/question-option.entity';
import { Question } from '../src/questions/entities/question.entity';
import { Attempt } from '../src/assessments/entities/attempt.entity';
import { AttemptAnswer } from '../src/assessments/entities/attempt-answer.entity';
import { Paper } from '../src/assessments/entities/paper.entity';

function columnsFor(target: Function): Set<string> {
  const storage = getMetadataArgsStorage();
  return new Set(
    storage.columns
      .filter((c) => c.target === target)
      .map((c) => c.propertyName),
  );
}

describe('Versioning policy (audit_report-2 P1-7)', () => {
  // ─── In-scope: must HAVE version_number ───────────────────────────
  describe('versioned entities', () => {
    it('SeatMapVersion exposes a numeric version_number column', () => {
      const cols = columnsFor(SeatMapVersion);
      expect(cols.has('version_number')).toBe(true);
    });

    it('QuestionExplanation exposes a numeric version_number column', () => {
      const cols = columnsFor(QuestionExplanation);
      expect(cols.has('version_number')).toBe(true);
    });
  });

  // ─── Out of scope: must NOT have version_number ───────────────────
  //
  // If someone adds a `version_number` column to one of these
  // entities, the policy decision in `docs/questions.md §21` is no
  // longer accurate and the audit story drifts. Trip a unit test so
  // they have to either revisit the decision OR walk back the column.
  describe('non-versioned entities', () => {
    const NON_VERSIONED: Array<[string, Function]> = [
      ['QuestionOption', QuestionOption],
      ['Question', Question],
      ['Attempt', Attempt],
      ['AttemptAnswer', AttemptAnswer],
      ['Paper', Paper],
    ];

    for (const [name, target] of NON_VERSIONED) {
      it(`${name} does NOT carry a version_number column`, () => {
        const cols = columnsFor(target);
        expect(cols.has('version_number')).toBe(false);
      });
    }
  });

  // ─── Constraint shape: explanation history must be monotone ──────
  //
  // The whole point of the explanation versioning surface is that
  // (question_id, version_number) is unique — duplicate version
  // numbers per question would break the auto-increment in
  // `QuestionsService.addExplanation` and produce ambiguous history.
  // This guard catches accidental removal of the @Unique decorator
  // in a refactor.
  it('QuestionExplanation enforces UNIQUE (question_id, version_number)', () => {
    const storage = getMetadataArgsStorage();
    const uq = storage.uniques.find((u) => u.target === QuestionExplanation);
    expect(uq).toBeDefined();
    const cols = (uq!.columns as string[]) || [];
    expect(cols).toEqual(
      expect.arrayContaining(['question_id', 'version_number']),
    );
  });
});
