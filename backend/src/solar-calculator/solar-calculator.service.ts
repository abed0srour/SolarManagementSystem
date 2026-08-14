import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { round2 } from '../common/calc';
import { SizingInput, projectReturns, sizeSystem } from '../common/solar-sizing';

interface ProductOption {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  salePrice: number;
  inStock: number;
  /** W for panels, kW for inverters, kWh for batteries. */
  spec: number;
  /** Secondary spec shown alongside, e.g. a battery's Ah at its own voltage. */
  specLabel?: string;
  count: number;
  lineTotal: number;
  /** Why this option cannot be fulfilled from stock today, if it cannot. */
  shortBy: number;
}

/**
 * How many of a category's products the engine could actually consider.
 *
 * Matching reads specs out of `Product.attributes`, so a panel with no wattage
 * is invisible to it. Silently returning nothing looks like a broken tool; this
 * lets the UI say "9 panels skipped — no wattage recorded", which is an
 * instruction the user can act on.
 */
interface Coverage {
  total: number;
  usable: number;
  missingSpec: number;
}

@Injectable()
export class SolarCalculatorService {
  constructor(private prisma: PrismaService) {}

  private async productsInCategory(categoryName: string) {
    return this.prisma.product.findMany({
      relationLoadStrategy: 'join',
      where: { isActive: true, deletedAt: null, subCategory: { category: { name: categoryName } } },
      include: { stockLevels: true, subCategory: { select: { name: true } } },
    });
  }

  /** Free stock: physically present minus what other orders have already claimed. */
  private stockOf(p: { stockLevels: { quantity: any; reserved: number }[] }) {
    return p.stockLevels.reduce((s, l) => s + Number(l.quantity) - l.reserved, 0);
  }

  async size(input: SizingInput) {
    const result = sizeSystem(input);
    const { requiredArrayKw, requiredInverterKw, requiredBackupKwh, continuousKw } = result.sizing;
    const { systemType, phase, batteryVoltage } = result.inputs;

    const [panels, inverters, batteries] = await Promise.all([
      this.productsInCategory('Solar Panels'),
      this.productsInCategory('Inverters'),
      this.productsInCategory('Batteries'),
    ]);

    // ---- Panels: cover the array wattage ----
    let panelsMissingSpec = 0;
    const panelOptions = panels
      .map((p) => {
        const wattage = Number((p.attributes as any)?.wattage ?? 0);
        if (!wattage) {
          panelsMissingSpec++;
          return null;
        }
        const count = Math.ceil((requiredArrayKw * 1000) / wattage);
        return this.option(p, wattage, count, `${wattage} W`);
      })
      .filter((o): o is ProductOption => !!o)
      .sort((a, b) => this.rank(a, b));

    // ---- Inverters: meet continuous load, and match the supply's phase ----
    const preferredSub = systemType === 'ON_GRID' ? 'On-grid' : systemType === 'OFF_GRID' ? 'Off-grid' : 'Hybrid';
    let invertersMissingSpec = 0;
    const inverterOptions = inverters
      .map((p) => {
        const attrs = p.attributes as any;
        const kw = Number(attrs?.capacityKw ?? 0);
        if (!kw) {
          invertersMissingSpec++;
          return null;
        }
        if (kw < requiredInverterKw) return null;
        const opt = this.option(p, kw, 1, `${kw} kW`);
        // A three-phase supply cannot be served by a single-phase inverter, so
        // a mismatch is excluded outright rather than merely ranked lower.
        const unitPhase: string = attrs?.phase ?? '';
        if (phase === 'THREE' && unitPhase && !/three/i.test(unitPhase)) return null;
        (opt as any)._pref = p.subCategory.name === preferredSub ? 0 : 1;
        return opt;
      })
      .filter((o): o is ProductOption => !!o)
      // Smallest sufficient unit of the right type, cheapest first.
      .sort((a, b) => ((a as any)._pref - (b as any)._pref) || a.spec - b.spec || this.rank(a, b));

    // ---- Batteries: cover the stored energy ----
    let batteriesMissingSpec = 0;
    const batteryOptions =
      requiredBackupKwh <= 0
        ? []
        : batteries
            .map((p) => {
              const attrs = p.attributes as any;
              const ah = Number(attrs?.capacityAh ?? 0);
              const volts = Number(attrs?.voltage ?? 0);
              // Prefer the stated energy; fall back to Ah × V for lead-acid
              // stock, which is almost always specced in amp-hours only.
              const kwh = Number(attrs?.capacityKwh ?? 0) || round2((ah * volts) / 1000);
              if (!kwh) {
                batteriesMissingSpec++;
                return null;
              }
              const count = Math.ceil(requiredBackupKwh / kwh);
              const label = ah && volts ? `${kwh} kWh · ${ah} Ah @ ${volts} V` : `${kwh} kWh`;
              return this.option(p, kwh, count, label);
            })
            .filter((o): o is ProductOption => !!o)
            .sort((a, b) => this.rank(a, b));

    const recommended = [panelOptions[0], inverterOptions[0], batteryOptions[0]].filter(Boolean) as ProductOption[];
    const estimatedTotal = round2(recommended.reduce((s, o) => s + o.lineTotal, 0));

    const coverage: Record<string, Coverage> = {
      panels: { total: panels.length, usable: panelOptions.length, missingSpec: panelsMissingSpec },
      inverters: { total: inverters.length, usable: inverterOptions.length, missingSpec: invertersMissingSpec },
      batteries: { total: batteries.length, usable: batteryOptions.length, missingSpec: batteriesMissingSpec },
    };

    return {
      inputs: { ...result.inputs, peakLoadKw: input.peakLoadKw ?? null, backupHours: input.backupHours ?? null },
      energy: result.energy,
      sizing: { ...result.sizing, batteryVoltage },
      options: {
        panels: panelOptions.slice(0, 4),
        inverters: inverterOptions.slice(0, 4),
        batteries: batteryOptions.slice(0, 4),
      },
      coverage,
      /** Why no inverter came back, when none did. */
      notes: {
        noInverterLargeEnough:
          inverterOptions.length === 0 && inverters.length > invertersMissingSpec
            ? { requiredKw: requiredInverterKw, continuousKw }
            : null,
      },
      recommended: { items: recommended, estimatedTotal },
      roi: projectReturns(
        requiredArrayKw,
        result.inputs.sunHoursPerDay,
        result.inputs.lossFactor,
        result.inputs.tariffPerKwh,
        estimatedTotal,
      ),
    };
  }

  private option(p: any, spec: number, count: number, specLabel?: string): ProductOption {
    const salePrice = Number(p.salePrice);
    const inStock = this.stockOf(p);
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      brand: p.brand,
      salePrice,
      inStock,
      spec,
      specLabel,
      count,
      lineTotal: round2(salePrice * count),
      shortBy: Math.max(0, count - inStock),
    };
  }

  /** In-stock options first, then cheapest bundle. */
  private rank(a: ProductOption, b: ProductOption) {
    return (a.shortBy > 0 ? 1 : 0) - (b.shortBy > 0 ? 1 : 0) || a.lineTotal - b.lineTotal;
  }
}
