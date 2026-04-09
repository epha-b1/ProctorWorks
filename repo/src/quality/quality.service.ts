import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { DataQualityRule, RuleType } from './entities/data-quality-rule.entity';
import { DataQualityScore } from './entities/data-quality-score.entity';
import { CreateQualityRuleDto } from './dto/create-quality-rule.dto';
import { NotificationsService } from '../notifications/notifications.service';

const ENTITY_TABLE_MAP: Record<string, string> = {
  products: 'products',
  orders: 'orders',
  questions: 'questions',
  users: 'users',
  inventory: 'inventory_lots',
};

const ALL_ENTITY_TYPES = Object.keys(ENTITY_TABLE_MAP);

/**
 * Strict allowlist of legal columns per entity_type for quality-rule
 * evaluation. Any column referenced in a rule config that does not appear
 * here is rejected — this is the security boundary that prevents SQL
 * identifier injection in raw query construction.
 *
 * Allowlists are restricted to columns that are safe to reference in raw
 * SQL contexts (no encrypted/sensitive fields). Updating this map requires
 * a code change and review.
 */
const ENTITY_COLUMN_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  products: new Set(['id', 'store_id', 'name', 'category_id', 'brand_id', 'status', 'created_at']),
  orders: new Set(['id', 'store_id', 'status', 'total_cents', 'discount_cents', 'idempotency_key', 'created_at']),
  questions: new Set(['id', 'store_id', 'type', 'body', 'status', 'created_by', 'created_at']),
  users: new Set(['id', 'username', 'role', 'store_id', 'status', 'failed_login_count', 'created_at', 'updated_at']),
  inventory: new Set(['id', 'sku_id', 'batch_code', 'expiration_date', 'quantity', 'created_at']),
};

/**
 * Identifier shape gate. Even when whitelisted, we re-verify that the
 * column name matches a strict snake_case identifier pattern before any
 * SQL composition. Defense-in-depth against allowlist bugs.
 */
const SAFE_IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;

function assertSafeIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER_RE.test(value)) {
    throw new BadRequestException(
      `Invalid ${label}: must match ${SAFE_IDENTIFIER_RE}`,
    );
  }
  return value;
}

function assertColumnAllowed(
  entityType: string,
  column: string,
  label: string,
): string {
  assertSafeIdentifier(column, label);
  const allowed = ENTITY_COLUMN_ALLOWLIST[entityType];
  if (!allowed) {
    throw new BadRequestException(`Unknown entity type: ${entityType}`);
  }
  if (!allowed.has(column)) {
    throw new BadRequestException(
      `Column "${column}" is not permitted for entity "${entityType}"`,
    );
  }
  return column;
}

function assertFiniteNumber(value: unknown, label: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new BadRequestException(`${label} must be a finite number`);
  }
  return n;
}

@Injectable()
export class QualityService {
  private readonly logger = new Logger(QualityService.name);

  constructor(
    @InjectRepository(DataQualityRule)
    private readonly ruleRepo: Repository<DataQualityRule>,
    @InjectRepository(DataQualityScore)
    private readonly scoreRepo: Repository<DataQualityScore>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createRule(dto: CreateQualityRuleDto): Promise<DataQualityRule> {
    // Validate config against the column allowlist *before* persisting,
    // so malicious or malformed rules never reach the evaluator.
    this.validateRuleConfig(dto.entityType, dto.ruleType as RuleType, dto.config);

    const rule = this.ruleRepo.create({
      entity_type: dto.entityType,
      rule_type: dto.ruleType as RuleType,
      config: dto.config,
    });
    return this.ruleRepo.save(rule);
  }

  /**
   * Validates a rule's config against the per-entity column allowlist.
   * Throws BadRequestException for any unsafe / unknown column or numeric.
   */
  private validateRuleConfig(
    entityType: string,
    ruleType: RuleType,
    config: any,
  ): void {
    if (!ENTITY_TABLE_MAP[entityType]) {
      throw new BadRequestException(`Unknown entity type: ${entityType}`);
    }
    if (!config || typeof config !== 'object') {
      throw new BadRequestException('Rule config must be an object');
    }

    switch (ruleType) {
      case RuleType.COMPLETENESS: {
        const fields = config.fields;
        if (!Array.isArray(fields) || fields.length === 0) {
          throw new BadRequestException(
            'completeness rule requires a non-empty `fields` array',
          );
        }
        for (const f of fields) {
          assertColumnAllowed(entityType, f, 'fields[]');
        }
        return;
      }
      case RuleType.RANGE: {
        if (config.column === undefined) {
          throw new BadRequestException('range rule requires `column`');
        }
        assertColumnAllowed(entityType, config.column, 'column');
        if (config.min !== undefined) assertFiniteNumber(config.min, 'min');
        if (config.max !== undefined) assertFiniteNumber(config.max, 'max');
        if (config.min === undefined && config.max === undefined) {
          throw new BadRequestException(
            'range rule requires at least one of `min` or `max`',
          );
        }
        return;
      }
      case RuleType.UNIQUENESS: {
        if (config.column === undefined) {
          throw new BadRequestException('uniqueness rule requires `column`');
        }
        assertColumnAllowed(entityType, config.column, 'column');
        return;
      }
      default:
        throw new BadRequestException(`Unknown rule type: ${ruleType}`);
    }
  }

  async findRules(): Promise<DataQualityRule[]> {
    return this.ruleRepo.find({ where: { active: true } });
  }

  async computeScore(entityType: string): Promise<DataQualityScore> {
    // Fail fast on bad input *before* issuing a DB query. Invalid entity
    // types must return 400, never 500 — raising a plain Error would fall
    // through to the global filter as INTERNAL_ERROR.
    const tableName = ENTITY_TABLE_MAP[entityType];
    if (!tableName) {
      throw new BadRequestException(
        `Unknown entity type "${entityType}". Allowed: ${ALL_ENTITY_TYPES.join(', ')}.`,
      );
    }

    const rules = await this.ruleRepo.find({
      where: { entity_type: entityType, active: true },
    });

    const ruleScores: number[] = [];

    for (const rule of rules) {
      const score = await this.evaluateRule(rule, tableName);
      ruleScores.push(score);
    }

    const finalScore =
      ruleScores.length > 0
        ? ruleScores.reduce((a, b) => a + b, 0) / ruleScores.length
        : 100;

    const scoreEntity = this.scoreRepo.create({
      entity_type: entityType,
      score: finalScore,
      computed_at: new Date(),
    });

    return this.scoreRepo.save(scoreEntity);
  }

  private async evaluateRule(
    rule: DataQualityRule,
    tableName: string,
  ): Promise<number> {
    switch (rule.rule_type) {
      case RuleType.COMPLETENESS:
        return this.evaluateCompleteness(rule, tableName);
      case RuleType.RANGE:
        return this.evaluateRange(rule, tableName);
      case RuleType.UNIQUENESS:
        return this.evaluateUniqueness(rule, tableName);
      default:
        return 100;
    }
  }

  private async evaluateCompleteness(
    rule: DataQualityRule,
    tableName: string,
  ): Promise<number> {
    // Re-validate at evaluation time (defense-in-depth) — rules persisted
    // before allowlist enforcement, or via direct DB writes, are still
    // safely rejected here.
    const fieldsRaw: unknown = rule.config?.fields;
    if (!Array.isArray(fieldsRaw) || fieldsRaw.length === 0) return 100;

    const fields = fieldsRaw.map((f) =>
      assertColumnAllowed(rule.entity_type, f as string, 'fields[]'),
    );

    const safeTable = assertSafeIdentifier(tableName, 'tableName');

    const totalResult = await this.dataSource.query(
      `SELECT COUNT(*) as total FROM "${safeTable}"`,
    );
    const total = parseInt(totalResult[0].total, 10);
    if (total === 0) return 100;

    const conditions = fields
      .map((f) => `"${f}" IS NOT NULL AND CAST("${f}" AS TEXT) <> ''`)
      .join(' AND ');

    const completeResult = await this.dataSource.query(
      `SELECT COUNT(*) as complete FROM "${safeTable}" WHERE ${conditions}`,
    );
    const complete = parseInt(completeResult[0].complete, 10);

    return (complete / total) * 100;
  }

  private async evaluateRange(
    rule: DataQualityRule,
    tableName: string,
  ): Promise<number> {
    const rawColumn = rule.config?.column;
    if (rawColumn === undefined) return 100;

    const column = assertColumnAllowed(rule.entity_type, rawColumn, 'column');
    const safeTable = assertSafeIdentifier(tableName, 'tableName');

    const totalResult = await this.dataSource.query(
      `SELECT COUNT(*) as total FROM "${safeTable}" WHERE "${column}" IS NOT NULL`,
    );
    const total = parseInt(totalResult[0].total, 10);
    if (total === 0) return 100;

    const params: any[] = [];
    let rangeCondition = `"${column}" IS NOT NULL`;
    if (rule.config?.min !== undefined) {
      const min = assertFiniteNumber(rule.config.min, 'min');
      params.push(min);
      rangeCondition += ` AND "${column}" >= $${params.length}`;
    }
    if (rule.config?.max !== undefined) {
      const max = assertFiniteNumber(rule.config.max, 'max');
      params.push(max);
      rangeCondition += ` AND "${column}" <= $${params.length}`;
    }

    const inRangeResult = await this.dataSource.query(
      `SELECT COUNT(*) as in_range FROM "${safeTable}" WHERE ${rangeCondition}`,
      params,
    );
    const inRange = parseInt(inRangeResult[0].in_range, 10);

    return (inRange / total) * 100;
  }

  private async evaluateUniqueness(
    rule: DataQualityRule,
    tableName: string,
  ): Promise<number> {
    const rawColumn = rule.config?.column;
    if (rawColumn === undefined) return 100;

    const column = assertColumnAllowed(rule.entity_type, rawColumn, 'column');
    const safeTable = assertSafeIdentifier(tableName, 'tableName');

    const totalResult = await this.dataSource.query(
      `SELECT COUNT(*) as total FROM "${safeTable}" WHERE "${column}" IS NOT NULL`,
    );
    const total = parseInt(totalResult[0].total, 10);
    if (total === 0) return 100;

    const uniqueResult = await this.dataSource.query(
      `SELECT COUNT(DISTINCT "${column}") as unique_count FROM "${safeTable}" WHERE "${column}" IS NOT NULL`,
    );
    const uniqueCount = parseInt(uniqueResult[0].unique_count, 10);

    return (uniqueCount / total) * 100;
  }

  async getScores(): Promise<DataQualityScore[]> {
    return this.dataSource.query(`
      SELECT DISTINCT ON (entity_type) *
      FROM data_quality_scores
      ORDER BY entity_type, computed_at DESC
    `);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async recomputeAllScores(): Promise<void> {
    this.logger.log('Recomputing all data quality scores');
    for (const entityType of ALL_ENTITY_TYPES) {
      try {
        await this.computeScore(entityType);
      } catch (err) {
        this.logger.error(
          `Failed to compute score for ${entityType}: ${(err as Error).message}`,
        );
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async checkFreshness(): Promise<void> {
    const thresholdHours =
      this.configService.get<number>('stalenessThresholdHours') || 24;

    for (const entityType of ALL_ENTITY_TYPES) {
      try {
        const tableName = ENTITY_TABLE_MAP[entityType];
        const safeTable = assertSafeIdentifier(tableName, 'tableName');
        const result = await this.dataSource.query(
          `
          SELECT GREATEST(
            MAX(CASE WHEN EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name = $1 AND column_name = 'updated_at'
            ) THEN updated_at ELSE NULL END),
            MAX(created_at)
          ) as last_activity
          FROM "${safeTable}"
        `,
          [safeTable],
        );

        const lastActivity = result[0]?.last_activity;
        if (!lastActivity) continue;

        const hoursSinceActivity =
          (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60);

        if (hoursSinceActivity > thresholdHours) {
          await this.notificationsService.createForAdmins(
            'data_staleness',
            `Data for "${entityType}" has not been updated in ${Math.round(hoursSinceActivity)} hours (threshold: ${thresholdHours}h).`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Freshness check failed for ${entityType}: ${(err as Error).message}`,
        );
      }
    }
  }
}
