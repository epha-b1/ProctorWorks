import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Sku } from '../../products/entities/sku.entity';

@Entity('inventory_lots')
export class InventoryLot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sku_id: string;

  @Column()
  batch_code: string;

  @Column({ type: 'date', nullable: true })
  expiration_date: string;

  @Column({ type: 'int', default: 0 })
  quantity: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => Sku)
  @JoinColumn({ name: 'sku_id' })
  sku: Sku;
}
