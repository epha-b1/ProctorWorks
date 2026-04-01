import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssessmentsService } from './assessments.service';
import { AssessmentsController } from './assessments.controller';
import { Paper } from './entities/paper.entity';
import { PaperQuestion } from './entities/paper-question.entity';
import { Attempt } from './entities/attempt.entity';
import { AttemptAnswer } from './entities/attempt-answer.entity';
import { Question } from '../questions/entities/question.entity';
import { QuestionOption } from '../questions/entities/question-option.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Paper,
      PaperQuestion,
      Attempt,
      AttemptAnswer,
      Question,
      QuestionOption,
    ]),
  ],
  controllers: [AssessmentsController],
  providers: [AssessmentsService],
  exports: [AssessmentsService],
})
export class AssessmentsModule {}
