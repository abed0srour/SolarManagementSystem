import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { round2 } from '../common/calc';

const CO2_KG_PER_KWH = 0.7;
const BATTERY_DEPTH_OF_DISCHARGE = 0.9; // LiFePO4

export interface SizingInput {
  monthlyKwh: number;
  sunHoursPerDay?: number;
  backupHours?: number;
  peakLoadKw?: number;
  systemType?: 'ON_GRID' | 'OFF_GRID' | 'HYBRID';
  lossFactor?: number;
  tariffPerKwh?: number;
}

interface ProductOption {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  salePrice: number;
  inStock: number;
  spec: number; // W for panels, kW for inverters, kWh for batteries
  count: number;
  lineTotal: number;
}

@Injectable()
export class SolarCalculatorService {
  constructor(private prisma: PrismaService) {}

  private async productsInCategory(categoryName: string) {
    return this.prisma.product.findMany({ relationLoadStrategy: 'join',
      where: { isActive: true, deletedAt: null, subCategory: { category: { name: categoryName } } },
      include: { stockLevels: true, subCategory: { select: { name: true } } },
    });
  }

  private stockOf(p: { stockLevels: { quantity: number; reserved: number }[] }) {
    return p.stockLevels.reduce((s, l) => s + l.quantity - l.reserved, 0);
  }

  async size(input: SizingInput) {
    const monthlyKwh = input.monthlyKwh;
    const sunHours = input.sunHoursPerDay ?? 4.5;
    const backupHours = input.backupHours ?? 8;
    const lossFactor = input.lossFactor ?? 0.8;
    const tariff = input.tariffPerKwh ?? 0.2;
    const systemType = input.systemType ?? 'HYBRID';

    const dailyKwh = monthlyKwh / 30;
    const requiredArrayKw = round2(dailyKwh / (sunHours * lossFactor));
    const requiredInverterKw = round2(Math.max(requiredArrayKw, input.peakLoadKw ?? 0));
    const requiredBackupKwh =
      systemType === 'ON_GRID' ? 0 : round2((dailyKwh / 24) * backupHours / BATTERY_DEPTH_OF_DISCHARGE);

    const [panels, inverters, batteries] = await Promise.all([
      this.productsInCategory('Solar Panels'),
      this.productsInCategory('Inverters'),
      this.productsInCategory('Batteries'),
    ]);

    const panelOptions: ProductOption[] = panels
      .map((p) => {
        const wattage = Number((p.attributes as any)?.wattage ?? 0);
        if (!wattage) return null;
        const count = Math.ceil((requiredArrayKw * 1000) / wattage);
        return this.option(p, wattage, count);
      })
      .filter((o): o is ProductOption => !!o)
      .sort((a, b) => this.rank(a, b));

    const preferredSub = systemType === 'ON_GRID' ? 'On-grid' : systemType === 'OFF_GRID' ? 'Off-grid' : 'Hybrid';
    const inverterOptions: ProductOption[] = inverters
      .map((p) => {
        const kw = Number((p.attributes as any)?.capacityKw ?? 0);
        if (!kw || kw < requiredInverterKw) return null;
        const opt = this.option(p, kw, 1);
        // Prefer inverters matching the requested system type, then smallest sufficient capacity.
        (opt as any)._pref = p.subCategory.name === preferredSub ? 0 : 1;
        return opt;
      })
      .filter((o): o is ProductOption => !!o)
      .sort((a, b) => ((a as any)._pref - (b as any)._pref) || a.spec - b.spec || this.rank(a, b));

    const batteryOptions: ProductOption[] =
      requiredBackupKwh <= 0
        ? []
        : batteries
            .map((p) => {
              const attrs = p.attributes as any;
              const kwh = Number(attrs?.capacityKwh ?? 0) || round2((Number(attrs?.capacityAh ?? 0) * Number(attrs?.voltage ?? 0)) / 1000);
              if (!kwh) return null;
              const count = Math.ceil(requiredBackupKwh / kwh);
              return this.option(p, kwh, count);
            })
            .filter((o): o is ProductOption => !!o)
            .sort((a, b) => this.rank(a, b));

    const recommended = [panelOptions[0], inverterOptions[0], batteryOptions[0]].filter(Boolean) as ProductOption[];
    const estimatedTotal = round2(recommended.reduce((s, o) => s + o.lineTotal, 0));

    const annualKwh = round2(requiredArrayKw * sunHours * 365 * lossFactor);
    const annualSavings = round2(annualKwh * tariff);
    return {
      inputs: { monthlyKwh, sunHours, backupHours, lossFactor, tariff, systemType, peakLoadKw: input.peakLoadKw ?? null },
      sizing: {
        dailyKwh: round2(dailyKwh),
        requiredArrayKw,
        requiredInverterKw,
        requiredBackupKwh,
      },
      options: {
        panels: panelOptions.slice(0, 4),
        inverters: inverterOptions.slice(0, 4),
        batteries: batteryOptions.slice(0, 4),
      },
      recommended: { items: recommended, estimatedTotal },
      roi: {
        annualProductionKwh: annualKwh,
        annualSavings,
        paybackYears: annualSavings > 0 && estimatedTotal > 0 ? round2(estimatedTotal / annualSavings) : null,
        co2SavedKgPerYear: round2(annualKwh * CO2_KG_PER_KWH),
        savings25Years: round2(annualSavings * 25),
      },
    };
  }

  private option(p: any, spec: number, count: number): ProductOption {
    const salePrice = Number(p.salePrice);
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      brand: p.brand,
      salePrice,
      inStock: this.stockOf(p),
      spec,
      count,
      lineTotal: round2(salePrice * count),
    };
  }

  /** In-stock options first, then cheapest bundle. */
  private rank(a: ProductOption, b: ProductOption) {
    const aStock = a.inStock >= a.count ? 0 : 1;
    const bStock = b.inStock >= b.count ? 0 : 1;
    return aStock - bStock || a.lineTotal - b.lineTotal;
  }
}
