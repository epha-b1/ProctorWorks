import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { StudyRoom } from './study-room.entity';
import { Seat } from './seat.entity';

@Entity('zones')
export class Zone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  room_id: string;

  @Column()
  name: string;

  @ManyToOne(() => StudyRoom, (room) => room.zones, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: StudyRoom;

  @OneToMany(() => Seat, (seat) => seat.zone)
  seats: Seat[];
}
