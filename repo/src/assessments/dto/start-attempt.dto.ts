import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StartAttemptDto {
  @ApiProperty()
  @IsUUID()
  paperId: string;
}
