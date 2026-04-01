import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { StudyRoom } from './study-room.entity';
import { User } from '../../auth/entities/user.entity';

@Entity('seat_map_versions')
@Unique(['room_id', 'version_number'])
export class SeatMapVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  room_id: string;

  @Column({ type: 'int' })
  version_number: number;

  @Column({ type: 'uuid' })
  created_by: string;

  @Column({ type: 'text' })
  change_note: string;

  @Column({ type: 'jsonb' })
  snapshot: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => StudyRoom, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: StudyRoom;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;
}
