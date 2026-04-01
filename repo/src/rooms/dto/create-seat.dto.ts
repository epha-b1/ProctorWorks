import { IsString, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSeatDto {
  @ApiProperty({ example: 'A-1' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  powerOutlet?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  quietZone?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  adaAccessible?: boolean;
}
