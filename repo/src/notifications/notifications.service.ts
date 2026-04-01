import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { User } from '../auth/entities/user.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async create(
    userId: string,
    type: string,
    message: string,
  ): Promise<Notification> {
    const notification = this.notificationRepo.create({
      user_id: userId,
      type,
      message,
    });
    return this.notificationRepo.save(notification);
  }

  async createForAdmins(type: string, message: string): Promise<void> {
    const admins = await this.userRepo
      .createQueryBuilder('user')
      .where('user.role IN (:...roles)', {
        roles: ['platform_admin', 'store_admin'],
      })
      .getMany();

    const notifications = admins.map((admin) =>
      this.notificationRepo.create({
        user_id: admin.id,
        type,
        message,
      }),
    );

    await this.notificationRepo.save(notifications);
  }

  async findByUser(
    userId: string,
    readFilter?: boolean,
  ): Promise<Notification[]> {
    const where: Record<string, any> = { user_id: userId };
    if (readFilter !== undefined) {
      where.read = readFilter;
    }
    return this.notificationRepo.find({
      where,
      order: { created_at: 'DESC' },
    });
  }

  async markAsRead(id: string): Promise<Notification> {
    await this.notificationRepo.update(id, { read: true });
    return this.notificationRepo.findOneByOrFail({ id });
  }
}
