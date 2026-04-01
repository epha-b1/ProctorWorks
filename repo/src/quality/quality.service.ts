import { Injectable, Logger } from '@nestjs/common';
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
    const rule = this.ruleRepo.create({
      entity_type: dto.entityType,
      rule_type: dto.ruleType as RuleType,
      config: dto.config,
    });
    return this.ruleRepo.save(rule);
  }

  async findRules(): Promise<DataQualityRule[]> {
    return this.ruleRepo.find({ where: { active: true } });
  }

  async computeScore(entityType: string): Promise<DataQualityScore> {
    const rules = await this.ruleRepo.find({
      where: { entity_type: entityType, active: true },
    });

    const tableName = ENTITY_TABLE_MAP[entityType];
    if (!tableName) {
      throw new Error(`Unknown entity type: ${entityType}`);
    }

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
    const fields: string[] = rule.config.fields || [];
    if (fields.length === 0) return 100;

    const totalResult = await this.dataSource.query(
      `SELECT COUNT(*) as total FROM "${tableName}"`,
    );
    const total = parseInt(totalResult[0].total, 10);
    if (total === 0) return 100;

    const conditions = fields
      .map(
        (f) =>
          `"${f}" IS NOT NULL AND CAST("${f}" AS TEXT) <> ''`,
      )
      .join(' AND ');

    const completeResult = await this.dataSource.query(
      `SELECT COUNT(*) as complete FROM "${tableName}" WHERE ${conditions}`,
    );
    const complete = parseInt(completeResult[0].complete, 10);

    return (complete / total) * 100;
  }

  private async evaluateRange(
    rule: DataQualityRule,
    tableName: string,
  ): Promise<number> {
    const { column, min, max } = rule.config;
    if (!column) return 100;

    const totalResult = await this.dataSource.query(
      `SELECT COUNT(*) as total FROM "${tableName}" WHERE "${column}" IS NOT NULL`,
    );
    const total = parseInt(totalResult[0].total, 10);
    if (total === 0) return 100;

    let rangeCondition = `"${column}" IS NOT NULL`;
    if (min !== undefined) {
      rangeCondition += ` AND "${column}" >= ${Number(min)}`;
    }
    if (max !== undefined) {
      rangeCondition += ` AND "${column}" <= ${Number(max)}`;
    }

    const inRangeResult = await this.dataSource.query(
      `SELECT COUNT(*) as in_range FROM "${tableName}" WHERE ${rangeCondition}`,
    );
    const inRange = parseInt(inRangeResult[0].in_range, 10);

    return (inRange / total) * 100;
  }

  private async evaluateUniqueness(
    rule: DataQualityRule,
    tableName: string,
  ): Promise<number> {
    const { column } = rule.config;
    if (!column) return 100;

    const totalResult = await this.dataSource.query(
      `SELECT COUNT(*) as total FROM "${tableName}" WHERE "${column}" IS NOT NULL`,
    );
    const total = parseInt(totalResult[0].total, 10);
    if (total === 0) return 100;

    const uniqueResult = await this.dataSource.query(
      `SELECT COUNT(DISTINCT "${column}") as unique_count FROM "${tableName}" WHERE "${column}" IS NOT NULL`,
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
        const result = await this.dataSource.query(`
          SELECT GREATEST(
            MAX(CASE WHEN EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name = '${tableName}' AND column_name = 'updated_at'
            ) THEN updated_at ELSE NULL END),
            MAX(created_at)
          ) as last_activity
          FROM "${tableName}"
        `);

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
