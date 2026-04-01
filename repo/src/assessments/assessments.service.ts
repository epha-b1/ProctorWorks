import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Paper } from './entities/paper.entity';
import { PaperQuestion } from './entities/paper-question.entity';
import { Attempt, AttemptStatus } from './entities/attempt.entity';
import { AttemptAnswer } from './entities/attempt-answer.entity';
import { Question, QuestionStatus, QuestionType } from '../questions/entities/question.entity';
import { QuestionOption } from '../questions/entities/question-option.entity';
import { GeneratePaperDto } from './dto/generate-paper.dto';
import { SubmitAnswerDto } from './dto/submit-attempt.dto';

@Injectable()
export class AssessmentsService {
  constructor(
    @InjectRepository(Paper)
    private readonly paperRepo: Repository<Paper>,
    @InjectRepository(PaperQuestion)
    private readonly paperQuestionRepo: Repository<PaperQuestion>,
    @InjectRepository(Attempt)
    private readonly attemptRepo: Repository<Attempt>,
    @InjectRepository(AttemptAnswer)
    private readonly answerRepo: Repository<AttemptAnswer>,
    @InjectRepository(Question)
    private readonly questionRepo: Repository<Question>,
    @InjectRepository(QuestionOption)
    private readonly optionRepo: Repository<QuestionOption>,
    private readonly dataSource: DataSource,
  ) {}

  async generatePaper(
    dto: GeneratePaperDto,
    userId: string,
    storeId?: string,
  ): Promise<Paper> {
    const { generationRule } = dto;
    let questions: Question[];

    if (generationRule.type === 'random') {
      const count = generationRule.count ?? 10;
      const qb = this.questionRepo
        .createQueryBuilder('q')
        .where('q.status = :status', { status: QuestionStatus.APPROVED });

      if (storeId) {
        qb.andWhere('(q.store_id = :storeId OR q.store_id IS NULL)', {
          storeId,
        });
      }

      questions = await qb
        .orderBy('RANDOM()')
        .limit(count)
        .getMany();
    } else {
      // rule-based
      const qb = this.questionRepo
        .createQueryBuilder('q')
        .where('q.status = :status', { status: QuestionStatus.APPROVED });

      if (storeId) {
        qb.andWhere('(q.store_id = :storeId OR q.store_id IS NULL)', {
          storeId,
        });
      }

      const filters = generationRule.filters ?? {};
      if (filters.type) {
        qb.andWhere('q.type = :type', { type: filters.type });
      }

      const count = generationRule.count;
      if (count) {
        qb.limit(count);
      }

      questions = await qb.getMany();
    }

    const paper = this.paperRepo.create({
      name: dto.name,
      generation_rule: generationRule as any,
      created_by: userId,
      store_id: storeId ?? null,
    });

    const savedPaper = await this.paperRepo.save(paper);

    const paperQuestions = questions.map((q, index) =>
      this.paperQuestionRepo.create({
        paper_id: savedPaper.id,
        question_id: q.id,
        position: index + 1,
      }),
    );

    await this.paperQuestionRepo.save(paperQuestions);
    savedPaper.paper_questions = paperQuestions;

    return savedPaper;
  }

  async startAttempt(paperId: string, userId: string): Promise<Attempt> {
    const paper = await this.paperRepo.findOne({ where: { id: paperId } });
    if (!paper) {
      throw new NotFoundException('Paper not found');
    }

    const attempt = this.attemptRepo.create({
      paper_id: paperId,
      user_id: userId,
      status: AttemptStatus.IN_PROGRESS,
      started_at: new Date(),
    });

    return this.attemptRepo.save(attempt);
  }

  async submitAttempt(
    attemptId: string,
    answers: SubmitAnswerDto[],
    userId: string,
  ): Promise<Attempt> {
    const attempt = await this.attemptRepo.findOne({
      where: { id: attemptId },
    });

    if (!attempt) {
      throw new NotFoundException('Attempt not found');
    }

    if (attempt.user_id !== userId) {
      throw new BadRequestException('Attempt does not belong to this user');
    }

    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('Attempt is not in progress');
    }

    const now = new Date();
    let correctCount = 0;
    let totalObjective = 0;
    const attemptAnswers: AttemptAnswer[] = [];

    for (const ans of answers) {
      const question = await this.questionRepo.findOne({
        where: { id: ans.questionId },
      });

      if (!question) {
        throw new NotFoundException(`Question ${ans.questionId} not found`);
      }

      let isCorrect: boolean | null = null;

      if (question.type === QuestionType.OBJECTIVE) {
        totalObjective++;

        if (ans.selectedOptionId) {
          const option = await this.optionRepo.findOne({
            where: { id: ans.selectedOptionId },
          });

          if (option) {
            isCorrect = option.is_correct;
            if (isCorrect) {
              correctCount++;
            }
          } else {
            isCorrect = false;
          }
        } else {
          isCorrect = false;
        }
      }
      // subjective: is_correct remains null

      const attemptAnswer = this.answerRepo.create({
        attempt_id: attemptId,
        question_id: ans.questionId,
        selected_option_id: ans.selectedOptionId ?? null,
        text_answer: ans.textAnswer ?? null,
        is_correct: isCorrect,
      });

      attemptAnswers.push(attemptAnswer);
    }

    await this.answerRepo.save(attemptAnswers);

    const score =
      totalObjective > 0
        ? Math.round((correctCount / totalObjective) * 10000) / 100
        : null;

    attempt.status = AttemptStatus.GRADED;
    attempt.graded_at = now;
    attempt.submitted_at = now;
    attempt.score = score;
    attempt.answers = attemptAnswers;

    return this.attemptRepo.save(attempt);
  }

  async redoAttempt(attemptId: string, userId: string): Promise<Attempt> {
    const original = await this.attemptRepo.findOne({
      where: { id: attemptId },
    });

    if (!original) {
      throw new NotFoundException('Attempt not found');
    }

    if (original.user_id !== userId) {
      throw new BadRequestException('Attempt does not belong to this user');
    }

    const newAttempt = this.attemptRepo.create({
      paper_id: original.paper_id,
      user_id: userId,
      parent_attempt_id: attemptId,
      status: AttemptStatus.IN_PROGRESS,
      started_at: new Date(),
    });

    return this.attemptRepo.save(newAttempt);
  }

  async getHistory(userId: string): Promise<Attempt[]> {
    return this.attemptRepo.find({
      where: { user_id: userId },
      order: { started_at: 'DESC' },
      relations: ['paper'],
    });
  }

  async getPapers(storeId?: string): Promise<Paper[]> {
    const where: any = {};
    if (storeId) {
      where.store_id = storeId;
    }
    return this.paperRepo.find({ where, relations: ['paper_questions'] });
  }

  async getPaper(id: string): Promise<Paper> {
    const paper = await this.paperRepo.findOne({
      where: { id },
      relations: ['paper_questions', 'paper_questions.question', 'paper_questions.question.options'],
    });

    if (!paper) {
      throw new NotFoundException('Paper not found');
    }

    return paper;
  }
}
