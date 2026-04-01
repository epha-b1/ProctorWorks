import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Paper } from './paper.entity';
import { AttemptAnswer } from './attempt-answer.entity';

export enum AttemptStatus {
  IN_PROGRESS = 'in_progress',
  SUBMITTED = 'submitted',
  GRADED = 'graded',
}

@Entity('attempts')
export class Attempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  paper_id: string;

  @ManyToOne(() => Paper)
  @JoinColumn({ name: 'paper_id' })
  paper: Paper;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  parent_attempt_id: string | null;

  @ManyToOne(() => Attempt, { nullable: true })
  @JoinColumn({ name: 'parent_attempt_id' })
  parent_attempt: Attempt | null;

  @Column({
    type: 'enum',
    enum: AttemptStatus,
    default: AttemptStatus.IN_PROGRESS,
  })
  status: AttemptStatus;

  @Column({ type: 'decimal', nullable: true })
  score: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  graded_at: Date | null;

  @Column({ type: 'timestamptz' })
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  submitted_at: Date | null;

  @OneToMany(() => AttemptAnswer, (aa) => aa.attempt, { cascade: true })
  answers: AttemptAnswer[];
}
