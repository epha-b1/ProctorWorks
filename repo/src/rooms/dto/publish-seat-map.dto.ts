import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PublishSeatMapDto {
  @ApiProperty({
    example: 'Added new power outlets to Zone B seats and rearranged Zone A layout',
    minLength: 20,
    maxLength: 500,
  })
  @IsString()
  @MinLength(20)
  @MaxLength(500)
  changeNote: string;
}
