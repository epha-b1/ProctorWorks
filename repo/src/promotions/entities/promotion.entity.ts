import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum PromotionType {
  THRESHOLD = 'threshold',
  PERCENTAGE = 'percentage',
  FIRST_ORDER = 'first_order',
}

export enum DiscountType {
  FIXED_CENTS = 'fixed_cents',
  PERCENTAGE = 'percentage',
}

@Entity('promotions')
export class Promotion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  store_id: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: PromotionType })
  type: PromotionType;

  @Column({ type: 'int' })
  priority: number;

  @Column({ type: 'enum', enum: DiscountType })
  discount_type: DiscountType;

  @Column({ type: 'int' })
  discount_value: number;

  @Column({ type: 'int', nullable: true })
  min_order_cents: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  starts_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  ends_at: Date | null;

  @Column({ type: 'int', nullable: true })
  redemption_cap: number | null;

  @Column({ type: 'int', default: 0 })
  redemption_count: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}
