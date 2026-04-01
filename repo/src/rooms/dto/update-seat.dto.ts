import { IsString, IsBoolean, IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SeatStatus } from '../entities/seat.entity';

export class UpdateSeatDto {
  @ApiPropertyOptional({ example: 'A-1' })
  @IsString()
  @IsOptional()
  label?: string;

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

  @ApiPropertyOptional({ enum: SeatStatus, example: SeatStatus.AVAILABLE })
  @IsEnum(SeatStatus)
  @IsOptional()
  status?: SeatStatus;
}
