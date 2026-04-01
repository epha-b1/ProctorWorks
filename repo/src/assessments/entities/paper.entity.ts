import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { PaperQuestion } from './paper-question.entity';

@Entity('papers')
export class Paper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  store_id: string | null;

  @Column()
  name: string;

  @Column({ type: 'jsonb' })
  generation_rule: Record<string, any>;

  @Column({ type: 'uuid' })
  created_by: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @OneToMany(() => PaperQuestion, (pq) => pq.paper, { cascade: true })
  paper_questions: PaperQuestion[];
}
