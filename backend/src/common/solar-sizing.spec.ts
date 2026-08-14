import { DEPTH_OF_DISCHARGE, powerFromCurrent, projectReturns, sizeSystem } from './solar-sizing';

describe('powerFromCurrent', () => {
  it('is V × I for DC', () => {
    expect(powerFromCurrent(50, 48, 'DC', 1)).toBe(2400);
  });

  it('ignores power factor on DC, where it has no meaning', () => {
    expect(powerFromCurrent(50, 48, 'DC', 0.5)).toBe(2400);
  });

  it('is V × I × pf for single-phase AC', () => {
    expect(powerFromCurrent(10, 230, 'SINGLE', 0.8)).toBe(1840);
  });

  it('is √3 × V × I × pf for three-phase', () => {
    // The factor that separates a correctly sized industrial system from one
    // undersized by 73%.
    // √3 × 400 × 32 × 0.8
    expect(powerFromCurrent(32, 400, 'THREE', 0.8)).toBeCloseTo(17736.2, 1);
    // …and it is exactly √3 times the single-phase figure at the same volts/amps.
    expect(powerFromCurrent(32, 400, 'THREE', 0.8) / powerFromCurrent(32, 400, 'SINGLE', 0.8)).toBeCloseTo(
      Math.sqrt(3),
      6,
    );
  });

  it('is zero when either side is zero', () => {
    expect(powerFromCurrent(0, 400, 'THREE', 0.8)).toBe(0);
    expect(powerFromCurrent(32, 0, 'THREE', 0.8)).toBe(0);
  });
});

describe('sizeSystem — LOAD mode', () => {
  const base = {
    mode: 'LOAD' as const,
    dayAmps: 40,
    dayHours: 8,
    nightAmps: 20,
    nightHours: 12,
    systemVoltage: 48,
    phase: 'DC' as const,
    sunHoursPerDay: 5,
    lossFactor: 0.8,
  };

  it('splits day and night energy from the measured current', () => {
    const r = sizeSystem(base);
    // 40 A × 48 V × 8 h = 15 360 Wh; 20 A × 48 V × 12 h = 11 520 Wh
    expect(r.energy.dayWh).toBe(15360);
    expect(r.energy.nightWh).toBe(11520);
    expect(r.energy.dailyKwh).toBe(26.88);
  });

  it('sizes the array to cover the whole day inside the sun window', () => {
    // 26.88 kWh / (5 h × 0.8)
    expect(sizeSystem(base).sizing.requiredArrayKw).toBe(6.72);
  });

  it('sizes the inverter on peak power, not on daily energy', () => {
    const r = sizeSystem(base);
    expect(r.sizing.continuousKw).toBe(1.92); // 40 A × 48 V
    expect(r.sizing.requiredInverterKw).toBe(2.4); // +25% headroom
  });

  it('lets a motor surge drive the inverter when it exceeds the continuous need', () => {
    const r = sizeSystem({ ...base, surgeFactor: 3 });
    expect(r.sizing.surgeKw).toBe(5.76);
    // 5.76 / 2 = 2.88 beats 1.92 × 1.25 = 2.4
    expect(r.sizing.requiredInverterKw).toBe(2.88);
  });

  it('ignores a surge small enough for the continuous headroom to absorb', () => {
    const r = sizeSystem({ ...base, surgeFactor: 2 });
    expect(r.sizing.requiredInverterKw).toBe(2.4);
  });

  it('sizes the battery on the night load, derated for depth of discharge', () => {
    const r = sizeSystem(base);
    // 11.52 kWh / (0.9 × 0.94)
    expect(r.sizing.requiredBackupKwh).toBeCloseTo(13.62, 1);
  });

  it('reports the bank in amp-hours at the bank voltage, not the supply voltage', () => {
    const r = sizeSystem({ ...base, batteryVoltage: 48 });
    expect(r.sizing.requiredBackupAh).toBeCloseTo((r.sizing.requiredBackupKwh * 1000) / 48, 1);
  });

  it('keeps the battery bank voltage independent of a 400 V three-phase supply', () => {
    const r = sizeSystem({ ...base, phase: 'THREE', systemVoltage: 400, batteryVoltage: 48 });
    expect(r.inputs.systemVoltage).toBe(400);
    expect(r.inputs.batteryVoltage).toBe(48);
    expect(r.sizing.requiredBackupAh).toBeCloseTo((r.sizing.requiredBackupKwh * 1000) / 48, 1);
  });

  it('multiplies storage by the days of autonomy', () => {
    const one = sizeSystem(base).sizing.requiredBackupKwh;
    const three = sizeSystem({ ...base, autonomyDays: 3 }).sizing.requiredBackupKwh;
    expect(three).toBeCloseTo(one * 3, 1);
  });

  it('needs no battery on grid-tied, where the grid is the storage', () => {
    const r = sizeSystem({ ...base, systemType: 'ON_GRID' });
    expect(r.sizing.requiredBackupKwh).toBe(0);
    expect(r.sizing.requiredBackupAh).toBe(0);
    // The array is still sized for the full load.
    expect(r.sizing.requiredArrayKw).toBe(6.72);
  });

  it('honours a stated peak that exceeds the measured average', () => {
    const r = sizeSystem({ ...base, peakLoadKw: 10 });
    expect(r.sizing.continuousKw).toBe(10);
    expect(r.sizing.requiredInverterKw).toBe(12.5);
  });

  it('applies power factor on AC but not on DC', () => {
    const ac = sizeSystem({ ...base, phase: 'SINGLE', systemVoltage: 230, powerFactor: 0.8 });
    const dc = sizeSystem({ ...base, phase: 'DC', systemVoltage: 230 });
    expect(ac.energy.dayWh).toBeCloseTo(dc.energy.dayWh * 0.8, 0);
  });

  it('infers LOAD mode when currents are given without a mode', () => {
    expect(sizeSystem({ dayAmps: 10, dayHours: 5, systemVoltage: 48, phase: 'DC' }).inputs.mode).toBe('LOAD');
  });

  it('survives an all-zero load without dividing by zero', () => {
    const r = sizeSystem({ mode: 'LOAD', dayAmps: 0, nightAmps: 0, dayHours: 0, nightHours: 0 });
    expect(r.energy.dailyKwh).toBe(0);
    expect(r.sizing.requiredArrayKw).toBe(0);
    expect(r.sizing.requiredBackupKwh).toBe(0);
    expect(Number.isFinite(r.sizing.requiredInverterKw)).toBe(true);
  });
});

describe('sizeSystem — BILL mode', () => {
  const base = { mode: 'BILL' as const, monthlyKwh: 600, sunHoursPerDay: 5, lossFactor: 0.8, backupHours: 8 };

  it('derives the daily figure from the monthly bill', () => {
    expect(sizeSystem(base).energy.dailyKwh).toBe(20);
  });

  it('splits the bill by the hours the battery must carry', () => {
    const r = sizeSystem(base);
    // 8 of 24 hours of an even load
    expect(r.energy.nightWh).toBeCloseTo(6666.67, 1);
    expect(r.energy.dayWh + r.energy.nightWh).toBeCloseTo(20000, 0);
  });

  it('sizes the array the same way as LOAD mode', () => {
    expect(sizeSystem(base).sizing.requiredArrayKw).toBe(5);
  });

  it('round-trips: the reported monthly figure matches what went in', () => {
    expect(sizeSystem(base).energy.monthlyKwh).toBe(600);
  });

  it('defaults to BILL mode when no currents are supplied', () => {
    expect(sizeSystem({ monthlyKwh: 600 }).inputs.mode).toBe('BILL');
  });
});

describe('projectReturns', () => {
  it('computes production, savings and payback', () => {
    const r = projectReturns(5, 5, 0.8, 0.2, 10000);
    expect(r.annualProductionKwh).toBe(7300); // 5 × 5 × 365 × 0.8
    expect(r.annualSavings).toBe(1460);
    expect(r.paybackYears).toBeCloseTo(6.85, 2);
  });

  it('reports no payback rather than infinity when nothing is saved', () => {
    expect(projectReturns(5, 5, 0.8, 0, 10000).paybackYears).toBeNull();
  });

  it('reports no payback when there is no cost to recover', () => {
    expect(projectReturns(5, 5, 0.8, 0.2, 0).paybackYears).toBeNull();
  });
});

describe('constants', () => {
  it('exposes the depth of discharge the battery figures depend on', () => {
    expect(DEPTH_OF_DISCHARGE).toBe(0.9);
  });
});
