import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  PrimaryColumn,
} from 'typeorm';
import { Paper } from './paper.entity';
import { Question } from '../../questions/entities/question.entity';

@Entity('paper_questions')
export class PaperQuestion {
  @PrimaryColumn({ type: 'uuid' })
  paper_id: string;

  @PrimaryColumn({ type: 'uuid' })
  question_id: string;

  @Column({ type: 'int' })
  position: number;

  @ManyToOne(() => Paper, (paper) => paper.paper_questions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'paper_id' })
  paper: Paper;

  @ManyToOne(() => Question)
  @JoinColumn({ name: 'question_id' })
  question: Question;
}
