import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Attempt } from './attempt.entity';
import { Question } from '../../questions/entities/question.entity';
import { QuestionOption } from '../../questions/entities/question-option.entity';

@Entity('attempt_answers')
export class AttemptAnswer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  attempt_id: string;

  @ManyToOne(() => Attempt, (attempt) => attempt.answers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'attempt_id' })
  attempt: Attempt;

  @Column({ type: 'uuid' })
  question_id: string;

  @ManyToOne(() => Question)
  @JoinColumn({ name: 'question_id' })
  question: Question;

  @Column({ type: 'uuid', nullable: true })
  selected_option_id: string | null;

  @ManyToOne(() => QuestionOption, { nullable: true })
  @JoinColumn({ name: 'selected_option_id' })
  selected_option: QuestionOption | null;

  @Column({ type: 'text', nullable: true })
  text_answer: string | null;

  @Column({ type: 'boolean', nullable: true })
  is_correct: boolean | null;
}
