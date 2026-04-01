import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateExplanationDto {
  @ApiProperty()
  @IsString()
  body: string;
}
