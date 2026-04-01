import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum RuleType {
  COMPLETENESS = 'completeness',
  RANGE = 'range',
  UNIQUENESS = 'uniqueness',
}

@Entity('data_quality_rules')
export class DataQualityRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  entity_type: string;

  @Column({ type: 'enum', enum: RuleType })
  rule_type: RuleType;

  @Column({ type: 'jsonb' })
  config: Record<string, any>;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
