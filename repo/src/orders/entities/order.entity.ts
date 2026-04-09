import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { OrderItem } from './order-item.entity';

export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FULFILLED = 'fulfilled',
  CANCELLED = 'cancelled',
}

@Entity('orders')
// audit_report-1 §5.4 / HIGH-1 — `idempotency_key` is intentionally
// NOT globally unique anymore. The same opaque key can legitimately
// exist for two different (store, actor) tuples, and uniqueness is
// enforced one level up by the composite UNIQUE INDEX on
// `idempotency_keys (operation_type, actor_id, store_id, key)`.
// Keep a non-unique index for the lookup path; the global UNIQUE
// constraint is dropped in migration `1711900000004-DropOrdersIdempotencyKeyUnique`.
@Index('IDX_orders_idempotency_key', ['idempotency_key'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  store_id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status: OrderStatus;

  @Column()
  idempotency_key: string;

  @Column({ type: 'int' })
  total_cents: number;

  @Column({ type: 'int', default: 0 })
  discount_cents: number;

  @Column({ type: 'uuid', nullable: true })
  coupon_id: string;

  @Column({ type: 'uuid', nullable: true })
  promotion_id: string;

  @Column({ type: 'text', nullable: true })
  internal_notes: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => OrderItem, (item) => item.order)
  items: OrderItem[];
}
