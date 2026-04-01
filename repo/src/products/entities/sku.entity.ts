import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Product } from './product.entity';
import { SkuPriceTier } from './sku-price-tier.entity';

@Entity('skus')
export class Sku {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  product_id: string;

  @Column({ unique: true })
  sku_code: string;

  @Column({ type: 'int' })
  price_cents: number;

  @Column({ type: 'int', nullable: true })
  member_price_cents: number;

  @Column({ type: 'jsonb', nullable: true })
  attributes: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => Product, (product) => product.skus)
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @OneToMany(() => SkuPriceTier, (tier) => tier.sku)
  priceTiers: SkuPriceTier[];
}
