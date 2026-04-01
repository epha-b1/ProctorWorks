import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Zone } from './zone.entity';

export enum SeatStatus {
  AVAILABLE = 'available',
  DISABLED = 'disabled',
  MAINTENANCE = 'maintenance',
}

@Entity('seats')
export class Seat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  zone_id: string;

  @Column()
  label: string;

  @Column({ type: 'boolean', default: false })
  power_outlet: boolean;

  @Column({ type: 'boolean', default: false })
  quiet_zone: boolean;

  @Column({ type: 'boolean', default: false })
  ada_accessible: boolean;

  @Column({
    type: 'enum',
    enum: SeatStatus,
    default: SeatStatus.AVAILABLE,
  })
  status: SeatStatus;

  @ManyToOne(() => Zone, (zone) => zone.seats, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'zone_id' })
  zone: Zone;
}
