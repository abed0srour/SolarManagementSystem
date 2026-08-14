import { round2 } from './calc';

/**
 * Solar system sizing.
 *
 * Pure arithmetic, deliberately kept away from Prisma so the numbers that end up
 * on a customer quotation can be unit-tested. Every fudge factor in here is a
 * named constant with a stated reason — a sizing tool whose assumptions are
 * invisible is one nobody can argue with when a system underperforms.
 */

/** How the load was described. */
export type SizingMode = 'BILL' | 'LOAD';

/**
 * DC systems have no power factor; AC ones do, and three-phase power is
 * √3·V·I·pf rather than V·I·pf. Getting this wrong missizes a three-phase
 * industrial system by 73%, so phase is an explicit input, never inferred.
 */
export type Phase = 'DC' | 'SINGLE' | 'THREE';

/** Usable fraction of a battery's rated capacity. LiFePO4 tolerates deep cycling. */
export const DEPTH_OF_DISCHARGE = 0.9;

/** Round-trip inverter/charger efficiency applied to stored energy. */
const INVERTER_EFFICIENCY = 0.94;

/** Continuous headroom over the measured peak, so the inverter is not run at 100%. */
const INVERTER_HEADROOM = 1.25;

/**
 * Multiple of its rating a typical inverter sustains for the seconds a motor
 * takes to start. Surge is divided by this rather than sized against directly —
 * demanding a 15 kW inverter for a 5 kW motor would be absurd.
 */
const INVERTER_SURGE_TOLERANCE = 2;

/** Default AC power factor. Motors and mixed loads sit around here. */
const DEFAULT_POWER_FACTOR = 0.8;

const CO2_KG_PER_KWH = 0.7;

export interface SizingInput {
  mode?: SizingMode;

  /** BILL mode: the customer's bill. */
  monthlyKwh?: number;

  /** LOAD mode: measured current and how long it runs. */
  dayAmps?: number;
  dayHours?: number;
  nightAmps?: number;
  nightHours?: number;

  /** Voltage the current was measured at. */
  systemVoltage?: number;
  phase?: Phase;
  powerFactor?: number;

  /** Starting current multiple of heavy machinery. 1 = no motors, 3 = typical induction motor. */
  surgeFactor?: number;

  sunHoursPerDay?: number;
  lossFactor?: number;

  /** BILL mode: hours of average load the battery must carry. */
  backupHours?: number;
  /** Days the bank should ride through with no sun. */
  autonomyDays?: number;
  /** Battery bank voltage, which is independent of a 400 V three-phase supply. */
  batteryVoltage?: number;

  /** Overrides the computed continuous load when the customer states it. */
  peakLoadKw?: number;

  tariffPerKwh?: number;
  systemType?: 'ON_GRID' | 'OFF_GRID' | 'HYBRID';
}

export interface SizingResult {
  inputs: Required<Pick<SizingInput, 'sunHoursPerDay' | 'lossFactor' | 'systemVoltage' | 'phase'>> & {
    mode: SizingMode;
    powerFactor: number;
    surgeFactor: number;
    autonomyDays: number;
    batteryVoltage: number;
    systemType: 'ON_GRID' | 'OFF_GRID' | 'HYBRID';
    tariffPerKwh: number;
    monthlyKwh: number | null;
  };
  energy: {
    dayWh: number;
    nightWh: number;
    dailyWh: number;
    dailyKwh: number;
    monthlyKwh: number;
    dayPowerW: number;
    nightPowerW: number;
  };
  sizing: {
    dailyKwh: number;
    requiredArrayKw: number;
    continuousKw: number;
    surgeKw: number;
    requiredInverterKw: number;
    requiredBackupKwh: number;
    requiredBackupAh: number;
  };
}

/**
 * Real power drawn by a current at a given voltage.
 *
 * Exported because the UI shows the derived wattage next to the amps the user
 * typed — seeing "32 A → 22.2 kW" is what catches a mistyped input before it
 * becomes a quotation.
 */
export function powerFromCurrent(amps: number, volts: number, phase: Phase, powerFactor: number): number {
  if (!amps || !volts) return 0;
  if (phase === 'DC') return amps * volts;
  if (phase === 'THREE') return Math.sqrt(3) * volts * amps * powerFactor;
  return volts * amps * powerFactor;
}

export function sizeSystem(input: SizingInput): SizingResult {
  const mode: SizingMode = input.mode ?? (input.dayAmps || input.nightAmps ? 'LOAD' : 'BILL');
  const phase: Phase = input.phase ?? 'SINGLE';
  const systemVoltage = input.systemVoltage ?? (phase === 'THREE' ? 400 : phase === 'DC' ? 48 : 230);
  const powerFactor = phase === 'DC' ? 1 : (input.powerFactor ?? DEFAULT_POWER_FACTOR);
  const sunHours = input.sunHoursPerDay ?? 4.5;
  const lossFactor = input.lossFactor ?? 0.8;
  const surgeFactor = input.surgeFactor ?? 1;
  const autonomyDays = input.autonomyDays ?? 1;
  const batteryVoltage = input.batteryVoltage ?? 48;
  const systemType = input.systemType ?? 'HYBRID';
  const tariff = input.tariffPerKwh ?? 0.2;

  let dayWh: number;
  let nightWh: number;
  let dayPowerW: number;
  let nightPowerW: number;

  if (mode === 'LOAD') {
    const dayHours = input.dayHours ?? 0;
    const nightHours = input.nightHours ?? 0;
    dayPowerW = powerFromCurrent(input.dayAmps ?? 0, systemVoltage, phase, powerFactor);
    nightPowerW = powerFromCurrent(input.nightAmps ?? 0, systemVoltage, phase, powerFactor);
    dayWh = dayPowerW * dayHours;
    nightWh = nightPowerW * nightHours;
  } else {
    // From a bill there is only a monthly total, so the split is by the hours
    // the battery has to cover — the same assumption the tool has always made.
    const dailyWh = ((input.monthlyKwh ?? 0) * 1000) / 30;
    const backupHours = input.backupHours ?? 8;
    nightWh = (dailyWh / 24) * backupHours;
    dayWh = dailyWh - nightWh;
    // An average, not a peak: a bill cannot reveal the instantaneous draw.
    dayPowerW = (input.dayHours ?? 0) > 0 ? dayWh / (input.dayHours as number) : dailyWh / 24;
    nightPowerW = backupHours > 0 ? nightWh / backupHours : 0;
  }

  const dailyWh = round2(dayWh + nightWh);
  const dailyKwh = round2(dailyWh / 1000);

  // The array must cover the whole day's energy inside the sun window, after
  // wiring, heat, soiling and conversion losses.
  const requiredArrayKw = round2(dailyKwh / (sunHours * lossFactor));

  // The inverter is sized on instantaneous power, never on daily energy.
  const measuredPeakKw = Math.max(dayPowerW, nightPowerW) / 1000;
  const continuousKw = round2(Math.max(measuredPeakKw, input.peakLoadKw ?? 0));
  const surgeKw = round2(continuousKw * surgeFactor);
  const requiredInverterKw = round2(
    Math.max(continuousKw * INVERTER_HEADROOM, surgeKw / INVERTER_SURGE_TOLERANCE),
  );

  // Grid-tied systems have the grid as their battery.
  const storedWh = systemType === 'ON_GRID' ? 0 : nightWh * autonomyDays;
  const requiredBackupKwh = round2(storedWh / 1000 / (DEPTH_OF_DISCHARGE * INVERTER_EFFICIENCY));
  const requiredBackupAh = round2((requiredBackupKwh * 1000) / batteryVoltage);

  return {
    inputs: {
      mode,
      sunHoursPerDay: sunHours,
      lossFactor,
      systemVoltage,
      phase,
      powerFactor,
      surgeFactor,
      autonomyDays,
      batteryVoltage,
      systemType,
      tariffPerKwh: tariff,
      monthlyKwh: input.monthlyKwh ?? null,
    },
    energy: {
      dayWh: round2(dayWh),
      nightWh: round2(nightWh),
      dailyWh,
      dailyKwh,
      monthlyKwh: round2(dailyKwh * 30),
      dayPowerW: round2(dayPowerW),
      nightPowerW: round2(nightPowerW),
    },
    sizing: {
      dailyKwh,
      requiredArrayKw,
      continuousKw,
      surgeKw,
      requiredInverterKw,
      requiredBackupKwh,
      requiredBackupAh,
    },
  };
}

/** Lifetime economics of the sized array. */
export function projectReturns(arrayKw: number, sunHours: number, lossFactor: number, tariff: number, capex: number) {
  const annualProductionKwh = round2(arrayKw * sunHours * 365 * lossFactor);
  const annualSavings = round2(annualProductionKwh * tariff);
  return {
    annualProductionKwh,
    annualSavings,
    paybackYears: annualSavings > 0 && capex > 0 ? round2(capex / annualSavings) : null,
    co2SavedKgPerYear: round2(annualProductionKwh * CO2_KG_PER_KWH),
    savings25Years: round2(annualSavings * 25),
  };
}
