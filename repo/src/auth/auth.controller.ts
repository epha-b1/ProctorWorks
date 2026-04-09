import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TraceId } from '../common/decorators/trace-id.decorator';
import { UserRole } from './entities/user.entity';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials or locked' })
  async login(@Body() dto: LoginDto, @Req() req: any, @TraceId() traceId?: string) {
    const ipAddress =
      (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      undefined;
    const userAgent = (req.headers?.['user-agent'] as string) || undefined;
    const result = await this.authService.login(dto.username, dto.password, {
      ipAddress,
      userAgent,
    });
    await this.auditService.log(
      result.user.id,
      'login',
      'user',
      result.user.id,
      undefined,
      traceId,
    );
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout — invalidates current JWT' })
  @ApiResponse({ status: 204, description: 'Logged out' })
  async logout(@CurrentUser() user: any, @TraceId() traceId?: string) {
    await this.authService.logout(user.id, user.jti);
    await this.auditService.log(
      user.id,
      'logout',
      'user',
      user.id,
      undefined,
      traceId,
    );
    return;
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  @ApiResponse({ status: 200, description: 'Current user info' })
  getMe(@CurrentUser() user: any) {
    return user;
  }

  @Patch('change-password')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change own password' })
  @ApiResponse({ status: 200, description: 'Password changed' })
  @ApiResponse({ status: 400, description: 'Current password incorrect' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
    @TraceId() traceId?: string,
  ) {
    await this.authService.changePassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
    );
    await this.auditService.log(
      userId,
      'change_password',
      'user',
      userId,
      undefined,
      traceId,
    );
    return { message: 'Password changed successfully' };
  }
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'List all users (platform_admin only)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated user list' })
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.authService.findAll(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Post()
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Create a new user (platform_admin only)' })
  @ApiResponse({ status: 201, description: 'User created' })
  @ApiResponse({ status: 409, description: 'Username already exists' })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser('id') actorId: string,
    @TraceId() traceId?: string,
  ) {
    const created = await this.authService.createUser(dto);
    await this.auditService.log(
      actorId,
      'create_user',
      'user',
      created.id,
      {
        role: created.role,
        storeId: created.store_id ?? null,
      },
      traceId,
    );
    return created;
  }

  @Get(':id')
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Get user by ID (platform_admin only)' })
  @ApiResponse({ status: 200, description: 'User found' })
  @ApiResponse({ status: 404, description: 'User not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.authService.findById(id);
  }

  @Patch(':id')
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Update user (platform_admin only)' })
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('id') actorId: string,
    @TraceId() traceId?: string,
  ) {
    return this.authService.updateUser(id, dto).then(async (updated) => {
      await this.auditService.log(
        actorId,
        'update_user',
        'user',
        id,
        { fields: Object.keys(dto || {}) },
        traceId,
      );
      return updated;
    });
  }

  @Delete(':id')
  @Roles(UserRole.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete user (platform_admin only)' })
  @ApiResponse({ status: 204, description: 'User deleted' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @TraceId() traceId?: string,
  ) {
    await this.authService.deleteUser(id);
    await this.auditService.log(
      actorId,
      'delete_user',
      'user',
      id,
      undefined,
      traceId,
    );
    return;
  }
}
