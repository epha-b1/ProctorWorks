import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { InventoryLot } from './inventory-lot.entity';

@Entity('inventory_adjustments')
export class InventoryAdjustment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  lot_id: string;

  @Column({ type: 'int' })
  delta: number;

  @Column()
  reason_code: string;

  @Column({ unique: true })
  idempotency_key: string;

  @Column({ type: 'uuid' })
  adjusted_by: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => InventoryLot)
  @JoinColumn({ name: 'lot_id' })
  lot: InventoryLot;
}
