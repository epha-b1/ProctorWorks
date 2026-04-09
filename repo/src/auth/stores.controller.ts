import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiProperty,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { Store } from './entities/store.entity';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from './entities/user.entity';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TraceId } from '../common/decorators/trace-id.decorator';
import { AuditService } from '../audit/audit.service';

export class CreateStoreDto {
  @ApiProperty({ example: 'Downtown Branch' })
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class UpdateStoreDto {
  @ApiProperty({ example: 'Uptown Branch', required: false })
  @IsString()
  @IsOptional()
  name?: string;
}

@ApiTags('stores')
@ApiBearerAuth()
@Controller('stores')
export class StoresController {
  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'List all stores (platform_admin only)' })
  @ApiResponse({ status: 200, description: 'List of stores' })
  findAll() {
    return this.storeRepository.find({ order: { created_at: 'DESC' } });
  }

  @Post()
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Create a store (platform_admin only)' })
  @ApiResponse({ status: 201, description: 'Store created' })
  async create(
    @Body() dto: CreateStoreDto,
    @CurrentUser('id') actorId: string,
    @TraceId() traceId?: string,
  ) {
    const store = this.storeRepository.create({ name: dto.name });
    const saved = await this.storeRepository.save(store);
    await this.auditService.log(
      actorId,
      'create_store',
      'store',
      saved.id,
      { name: saved.name },
      traceId,
    );
    return saved;
  }

  @Patch(':id')
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Update a store (platform_admin only)' })
  @ApiResponse({ status: 200, description: 'Store updated' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoreDto,
    @CurrentUser('id') actorId: string,
    @TraceId() traceId?: string,
  ) {
    const store = await this.storeRepository.findOne({ where: { id } });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    if (dto.name !== undefined) {
      store.name = dto.name;
    }
    const saved = await this.storeRepository.save(store);
    await this.auditService.log(
      actorId,
      'update_store',
      'store',
      id,
      { fields: Object.keys(dto || {}) },
      traceId,
    );
    return saved;
  }

  @Delete(':id')
  @Roles(UserRole.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a store (platform_admin only)' })
  @ApiResponse({ status: 204, description: 'Store deleted' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @TraceId() traceId?: string,
  ) {
    const store = await this.storeRepository.findOne({ where: { id } });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    await this.storeRepository.remove(store);
    await this.auditService.log(
      actorId,
      'delete_store',
      'store',
      id,
      undefined,
      traceId,
    );
  }
}
