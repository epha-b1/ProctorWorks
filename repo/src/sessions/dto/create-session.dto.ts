import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  user_id: string;

  @IsString()
  token_hash: string;

  @IsOptional()
  @IsString()
  ip_address?: string;

  @IsOptional()
  @IsString()
  user_agent?: string;

  @IsDateString()
  expires_at: string;
}