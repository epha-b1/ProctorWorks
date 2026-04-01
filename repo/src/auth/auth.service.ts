import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User, UserStatus } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { EncryptionService } from '../common/encryption.service';

@Injectable()
export class AuthService {
  private readonly bcryptRounds: number;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly encryptionService: EncryptionService,
  ) {
    this.bcryptRounds = this.configService.get<number>('bcrypt.rounds', 12);
  }

  async login(
    username: string,
    password: string,
  ): Promise<{ accessToken: string; user: { id: string; username: string; role: string } }> {
    const user = await this.userRepository.findOne({ where: { username } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Account is suspended');
    }

    // Check lockout
    if (user.locked_until && user.locked_until > new Date()) {
      throw new UnauthorizedException(
        'Account is temporarily locked. Please try again later.',
      );
    }

    // If lock has expired, reset it
    if (user.locked_until && user.locked_until <= new Date()) {
      user.locked_until = null;
      user.failed_login_count = 0;
      user.status = UserStatus.ACTIVE;
      await this.userRepository.save(user);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      user.failed_login_count += 1;

      if (user.failed_login_count >= 5) {
        user.locked_until = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
        user.status = UserStatus.LOCKED;
      }

      await this.userRepository.save(user);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed login count on success
    if (user.failed_login_count > 0) {
      user.failed_login_count = 0;
      user.locked_until = null;
      user.status = UserStatus.ACTIVE;
      await this.userRepository.save(user);
    }

    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      storeId: user.store_id,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    };
  }

  async validateUser(payload: { sub: string }): Promise<User | null> {
    return this.userRepository.findOne({ where: { id: payload.sub } });
  }

  async createUser(dto: CreateUserDto): Promise<User> {
    const existing = await this.userRepository.findOne({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException('Username already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds);

    const user = this.userRepository.create({
      username: dto.username,
      password_hash: passwordHash,
      role: dto.role,
      store_id: dto.storeId || null,
    });

    const saved = await this.userRepository.save(user);

    // Remove password_hash from response
    delete (saved as any).password_hash;
    return saved;
  }

  async updateUser(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.status !== undefined) {
      user.status = dto.status;
    }
    if (dto.role !== undefined) {
      user.role = dto.role;
    }
    if (dto.storeId !== undefined) {
      user.store_id = dto.storeId;
    }
    if (dto.notes !== undefined) {
      user.notes = dto.notes ? this.encryptionService.encrypt(dto.notes) : null;
    }

    const saved = await this.userRepository.save(user);
    delete (saved as any).password_hash;
    return saved;
  }

  async deleteUser(id: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await this.userRepository.remove(user);
  }

  async findAll(
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: User[]; total: number; page: number; limit: number }> {
    const [data, total] = await this.userRepository.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
      select: [
        'id',
        'username',
        'role',
        'store_id',
        'status',
        'failed_login_count',
        'locked_until',
        'created_at',
        'updated_at',
      ],
    });

    return { data, total, page, limit };
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      select: [
        'id',
        'username',
        'role',
        'store_id',
        'status',
        'failed_login_count',
        'locked_until',
        'notes',
        'created_at',
        'updated_at',
      ],
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    // Decrypt notes if encrypted
    if (user.notes && this.encryptionService.isEncrypted(user.notes)) {
      user.notes = this.encryptionService.decrypt(user.notes);
    }
    return user;
  }

  async updateNotes(id: string, notes: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    user.notes = this.encryptionService.encrypt(notes);
    return this.userRepository.save(user);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isCurrentValid = await bcrypt.compare(
      currentPassword,
      user.password_hash,
    );
    if (!isCurrentValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    user.password_hash = await bcrypt.hash(newPassword, this.bcryptRounds);
    await this.userRepository.save(user);
  }
}
