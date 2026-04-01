import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateZoneDto {
  @ApiProperty({ example: 'Zone A' })
  @IsString()
  @IsNotEmpty()
  name: string;
}
