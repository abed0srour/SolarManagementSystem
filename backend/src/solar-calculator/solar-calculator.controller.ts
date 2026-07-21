import { Body, Controller, Post } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { SolarCalculatorService } from './solar-calculator.service';

class SizingDto {
  @IsNumber()
  @Min(1)
  monthlyKwh: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(12)
  sunHoursPerDay?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(24)
  backupHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  peakLoadKw?: number;

  @IsOptional()
  @IsIn(['ON_GRID', 'OFF_GRID', 'HYBRID'])
  systemType?: 'ON_GRID' | 'OFF_GRID' | 'HYBRID';

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(1)
  lossFactor?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tariffPerKwh?: number;
}

@Controller('solar-calculator')
export class SolarCalculatorController {
  constructor(private service: SolarCalculatorService) {}

  @Post('size')
  size(@Body() dto: SizingDto) {
    return this.service.size(dto);
  }
}
