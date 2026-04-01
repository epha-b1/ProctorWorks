import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Sku } from './sku.entity';

@Entity('sku_price_tiers')
export class SkuPriceTier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sku_id: string;

  @Column()
  tier_name: string;

  @Column({ type: 'int' })
  price_cents: number;

  @ManyToOne(() => Sku, (sku) => sku.priceTiers)
  @JoinColumn({ name: 'sku_id' })
  sku: Sku;
}
