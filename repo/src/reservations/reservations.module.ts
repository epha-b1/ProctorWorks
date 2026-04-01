import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reservation } from './entities/reservation.entity';
import { Seat } from '../rooms/entities/seat.entity';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Reservation, Seat])],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
