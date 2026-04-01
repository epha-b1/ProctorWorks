import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Coupon } from './coupon.entity';

@Entity('coupon_claims')
export class CouponClaim {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  coupon_id: string;

  @ManyToOne(() => Coupon)
  @JoinColumn({ name: 'coupon_id' })
  coupon: Coupon;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'timestamptz' })
  claimed_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  redeemed_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  order_id: string | null;
}
