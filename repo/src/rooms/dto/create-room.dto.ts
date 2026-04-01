import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoomDto {
  @ApiProperty({ example: 'Main Study Hall' })
  @IsString()
  @IsNotEmpty()
  name: string;
}
