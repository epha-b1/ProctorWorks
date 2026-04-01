import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudyRoom } from './entities/study-room.entity';
import { Zone } from './entities/zone.entity';
import { Seat } from './entities/seat.entity';
import { SeatMapVersion } from './entities/seat-map-version.entity';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([StudyRoom, Zone, Seat, SeatMapVersion]),
  ],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [TypeOrmModule],
})
export class RoomsModule {}
