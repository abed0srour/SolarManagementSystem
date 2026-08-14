import { Body, Controller, Post } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { SolarCalculatorService } from './solar-calculator.service';

class SizingDto {
  /**
   * BILL sizes from the customer's monthly consumption; LOAD sizes from current
   * measured on site, which is the only way to size for a specific machine.
   */
  @IsOptional()
  @IsIn(['BILL', 'LOAD'])
  mode?: 'BILL' | 'LOAD';

  // Required in BILL mode only — LOAD mode derives energy from the amps instead.
  @ValidateIf((o) => (o.mode ?? 'BILL') === 'BILL')
  @IsNumber()
  @Min(1)
  monthlyKwh?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  dayAmps?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(24)
  dayHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  nightAmps?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(24)
  nightHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(12)
  @Max(1000)
  systemVoltage?: number;

  @IsOptional()
  @IsIn(['DC', 'SINGLE', 'THREE'])
  phase?: 'DC' | 'SINGLE' | 'THREE';

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(1)
  powerFactor?: number;

  /** 1 = resistive load, 3 = typical induction motor inrush. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  surgeFactor?: number;

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
  @Min(1)
  @Max(7)
  autonomyDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(12)
  @Max(1000)
  batteryVoltage?: number;

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
