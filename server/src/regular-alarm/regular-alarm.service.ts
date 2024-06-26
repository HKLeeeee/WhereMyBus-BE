import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RegularAlarm } from './regular-alarm.schema';
import { EnrollRequestDto } from './dto/request/enroll.request.dto';
import { MESSAGE } from '../common/message';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BusInfoService } from '../bus-info/bus-info.service';
import { FcmService } from '../fcm/fcm.service';
import { ResponseData } from '../bus-info/arrival-info.type';
import * as path from 'path';

@Injectable()
export class RegularAlarmService {
  private readonly serviceKey;
  private readonly apiUrl;
  private logger = new Logger(RegularAlarmService.name);

  constructor(
    @InjectModel(RegularAlarm.name)
    private regularAlarmModel: Model<RegularAlarm>,
    private configService: ConfigService,
    private busInfoService: BusInfoService,
    private fcmService: FcmService,
  ) {
    this.serviceKey = this.configService.get<string>('SERVICE_KEY');
    this.apiUrl = this.configService.get<string>('BUS_INFO_API');
  }

  async enrollAlarm(enrollRegularDto: EnrollRequestDto): Promise<RegularAlarm> {
    const newAlarm = new this.regularAlarmModel(enrollRegularDto);
    return newAlarm.save();
  }

  async deleteAlarm(deviceToken: string, alarmId: string) {
    const findAlarm = await this.regularAlarmModel.findOneAndDelete({
      _id: alarmId,
      deviceToken: deviceToken,
    });

    if (!findAlarm) {
      throw new BadRequestException(MESSAGE.EXCEPTION.ALARM_INFO_ERROR);
    }
  }

  async getAll(): Promise<RegularAlarm[]> {
    return this.regularAlarmModel.find();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async regularAlarm() {
    const now = new Date();
    const time = this.timeString(now);
    const day = now.getDay();
    this.logger.log(`${time}, ${day} - regularAlarm`);
    await this.sendNotification(time, day);
  }

  async sendNotification(time: string, day: number) {
    const infos = await this.getEnrolledRegularAlarm(time, day);
    this.logger.log(`${infos.length} regular alarm founded`);
    const stationArrivalInfoMap: Map<string, ResponseData> = new Map();
    for (const info of infos) {
      const stationId = info.arsId;

      if (!stationArrivalInfoMap.has(stationId)) {
        const result = await this.busInfoService.arriveStation(info.arsId);
        stationArrivalInfoMap.set(stationId, result);
      }
    }

    const wrongData = [];
    infos.forEach((info) => {
      const busInfo = stationArrivalInfoMap
        .get(info.arsId)
        .msgBody.itemList.filter((each) => each.busRouteId === info.busRouteId);
      if (busInfo.length > 0) {
        const message = `${busInfo[0].busRouteAbrv} ${busInfo[0].arrmsg1}`;
        try {
          this.fcmService.send(info.deviceToken, message);
        } catch (e) {
          this.logger.error(e);
        }
      } else {
        this.fcmService.send(info.deviceToken, MESSAGE.NOTIFICATION.ERROR);
        wrongData.push(info._id);
      }
    });

    await this.regularAlarmModel.deleteMany({ _id: { $in: wrongData } });
  }
  async getEnrolledRegularAlarm(time: string, weekday: number) {
    return this.regularAlarmModel.find({
      time: time,
      day: weekday,
    });
  }

  timeString(now: Date) {
    return (
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0')
    );
  }
}
