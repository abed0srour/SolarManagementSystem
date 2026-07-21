import { PrismaClient, AttributeType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'abd.srour313@gmail.com';
const LEGACY_ADMIN_EMAIL = 'admin@solarstore.local';

async function main() {
  // Admin user — the legacy admin (if present) is renamed in place so all of
  // its history (orders, audit logs, …) stays attached to the same user row.
  const passwordHash = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  const legacy = await prisma.user.findUnique({ where: { email: LEGACY_ADMIN_EMAIL } });
  if (admin) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash, isActive: true, failedLoginAttempts: 0, lockedUntil: null },
    });
    if (legacy) {
      // Both exist: keep the new one, remove the legacy account (fall back to
      // deactivating it when foreign keys still reference it).
      try {
        await prisma.user.delete({ where: { id: legacy.id } });
      } catch {
        await prisma.user.update({ where: { id: legacy.id }, data: { isActive: false, deletedAt: new Date() } });
      }
    }
  } else if (legacy) {
    await prisma.user.update({
      where: { id: legacy.id },
      data: { email: ADMIN_EMAIL, passwordHash, isActive: true, failedLoginAttempts: 0, lockedUntil: null },
    });
  } else {
    await prisma.user.create({ data: { email: ADMIN_EMAIL, passwordHash, name: 'Admin', role: 'ADMIN' } });
  }

  // Default warehouse
  await prisma.warehouse.upsert({
    where: { name: 'Main Warehouse' },
    update: {},
    create: { name: 'Main Warehouse', isDefault: true },
  });

  // Number sequences
  const sequences: [string, string][] = [
    ['INVOICE', 'INV-'],
    ['QUOTATION', 'QT-'],
    ['SALES_ORDER', 'SO-'],
    ['PURCHASE_ORDER', 'PO-'],
    ['PAYMENT', 'PAY-'],
    ['REFUND', 'RF-'],
    ['CLAIM', 'WC-'],
    ['JOB', 'JOB-'],
    ['SUPPLIER_RETURN', 'SR-'],
    ['INSTALLATION', 'INST-'],
    ['EXPENSE', 'EXP-'],
    ['CONTRACT', 'MC-'],
  ];
  for (const [entity, prefix] of sequences) {
    await prisma.numberSequence.upsert({
      where: { entity },
      update: {},
      create: { entity, prefix, nextNumber: 1, padding: 5 },
    });
  }

  // Settings
  await prisma.setting.upsert({
    where: { key: 'company' },
    update: {},
    create: {
      key: 'company',
      value: { name: 'Solar Store', address: '', phone: '', email: '', taxNumber: '', logoUrl: '' },
    },
  });
  await prisma.setting.upsert({
    where: { key: 'finance' },
    update: {},
    create: {
      key: 'finance',
      value: { defaultTaxRatePct: 11, baseCurrency: 'USD', secondaryCurrency: 'LBP', exchangeRate: 89500 },
    },
  });

  // Categories with attribute definitions
  const solar = await prisma.category.upsert({
    where: { name: 'Solar Panels' },
    update: {},
    create: { name: 'Solar Panels', description: 'Photovoltaic solar panels' },
  });
  const inverters = await prisma.category.upsert({
    where: { name: 'Inverters' },
    update: {},
    create: { name: 'Inverters', description: 'Solar inverters' },
  });
  const batteries = await prisma.category.upsert({
    where: { name: 'Batteries' },
    update: {},
    create: { name: 'Batteries', description: 'Energy storage batteries' },
  });

  type AttrDef = { name: string; label: string; type: AttributeType; unit?: string; options?: string[]; required?: boolean };

  async function subCatWithAttrs(categoryId: string, name: string, attrs: AttrDef[]) {
    const sub = await prisma.subCategory.upsert({
      where: { categoryId_name: { categoryId, name } },
      update: {},
      create: { categoryId, name },
    });
    let order = 0;
    for (const a of attrs) {
      await prisma.attributeDefinition.upsert({
        where: { subCategoryId_name: { subCategoryId: sub.id, name: a.name } },
        update: {},
        create: {
          subCategoryId: sub.id,
          name: a.name,
          label: a.label,
          type: a.type,
          unit: a.unit,
          options: a.options ?? undefined,
          required: a.required ?? false,
          sortOrder: order++,
        },
      });
    }
    return sub;
  }

  const monoSub = await subCatWithAttrs(solar.id, 'Monocrystalline', [
    { name: 'wattage', label: 'Wattage', type: 'NUMBER', unit: 'W', required: true },
    { name: 'dimensions', label: 'Dimensions (LxWxH)', type: 'TEXT', unit: 'mm' },
    { name: 'weight', label: 'Weight', type: 'NUMBER', unit: 'kg' },
    { name: 'cellCount', label: 'Cell Count', type: 'NUMBER' },
    { name: 'efficiency', label: 'Efficiency', type: 'NUMBER', unit: '%' },
  ]);
  await subCatWithAttrs(solar.id, 'Polycrystalline', [
    { name: 'wattage', label: 'Wattage', type: 'NUMBER', unit: 'W', required: true },
    { name: 'dimensions', label: 'Dimensions (LxWxH)', type: 'TEXT', unit: 'mm' },
    { name: 'weight', label: 'Weight', type: 'NUMBER', unit: 'kg' },
    { name: 'cellCount', label: 'Cell Count', type: 'NUMBER' },
  ]);

  const inverterAttrs: AttrDef[] = [
    { name: 'capacityKw', label: 'Capacity', type: 'NUMBER', unit: 'kW', required: true },
    { name: 'phase', label: 'Phase', type: 'SELECT', options: ['Single-phase', 'Three-phase'] },
    { name: 'maxInputVoltage', label: 'Max Input Voltage', type: 'NUMBER', unit: 'V' },
    { name: 'mpptTrackers', label: 'MPPT Trackers', type: 'NUMBER' },
    { name: 'batteryVoltage', label: 'Compatible Battery Voltage', type: 'TEXT', unit: 'V' },
  ];
  await subCatWithAttrs(inverters.id, 'On-grid', inverterAttrs);
  await subCatWithAttrs(inverters.id, 'Off-grid', inverterAttrs);
  const hybridSub = await subCatWithAttrs(inverters.id, 'Hybrid', inverterAttrs);

  const batteryAttrs: AttrDef[] = [
    { name: 'capacityAh', label: 'Capacity', type: 'NUMBER', unit: 'Ah', required: true },
    { name: 'capacityKwh', label: 'Energy', type: 'NUMBER', unit: 'kWh' },
    { name: 'voltage', label: 'Voltage', type: 'NUMBER', unit: 'V', required: true },
    { name: 'cycleLife', label: 'Cycle Life', type: 'NUMBER', unit: 'cycles' },
  ];
  const lifepo4Sub = await subCatWithAttrs(batteries.id, 'Lithium (LiFePO4)', batteryAttrs);
  await subCatWithAttrs(batteries.id, 'Lithium (Li-ion)', batteryAttrs);
  await subCatWithAttrs(batteries.id, 'Lead-acid (Flooded)', batteryAttrs);
  await subCatWithAttrs(batteries.id, 'Lead-acid (AGM)', batteryAttrs);
  await subCatWithAttrs(batteries.id, 'Lead-acid (Gel)', batteryAttrs);

  // Demo products so the solar sizing calculator has stock to recommend
  const warehouse = await prisma.warehouse.findUniqueOrThrow({ where: { name: 'Main Warehouse' } });
  const demoProducts = [
    { sku: 'PAN-JINKO-580', name: 'Jinko Tiger Neo 580W', brand: 'Jinko', model: 'JKM580N-72HL4', subCategoryId: monoSub.id, attributes: { wattage: 580, efficiency: 22.3 }, costPrice: 95, salePrice: 135, warrantyMonths: 144, performanceWarrantyMonths: 300, qty: 60 },
    { sku: 'PAN-LONGI-555', name: 'LONGi Hi-MO 6 555W', brand: 'LONGi', model: 'LR5-72HTH-555M', subCategoryId: monoSub.id, attributes: { wattage: 555, efficiency: 21.5 }, costPrice: 88, salePrice: 125, warrantyMonths: 144, performanceWarrantyMonths: 300, qty: 40 },
    { sku: 'INV-DEYE-5K', name: 'Deye 5kW Hybrid Inverter', brand: 'Deye', model: 'SUN-5K-SG04LP1', subCategoryId: hybridSub.id, attributes: { capacityKw: 5, phase: 'Single-phase', mpptTrackers: 2 }, costPrice: 620, salePrice: 850, warrantyMonths: 60, qty: 12 },
    { sku: 'INV-DEYE-8K', name: 'Deye 8kW Hybrid Inverter', brand: 'Deye', model: 'SUN-8K-SG01LP1', subCategoryId: hybridSub.id, attributes: { capacityKw: 8, phase: 'Single-phase', mpptTrackers: 2 }, costPrice: 950, salePrice: 1290, warrantyMonths: 60, qty: 8 },
    { sku: 'BAT-PYLON-5K', name: 'Pylontech US5000 4.8kWh', brand: 'Pylontech', model: 'US5000', subCategoryId: lifepo4Sub.id, attributes: { capacityAh: 100, capacityKwh: 4.8, voltage: 48, cycleLife: 6000 }, costPrice: 980, salePrice: 1350, warrantyMonths: 84, qty: 16 },
    { sku: 'BAT-DYNESS-5K', name: 'Dyness B4850 5.12kWh', brand: 'Dyness', model: 'B4850', subCategoryId: lifepo4Sub.id, attributes: { capacityAh: 100, capacityKwh: 5.12, voltage: 51.2, cycleLife: 6000 }, costPrice: 890, salePrice: 1250, warrantyMonths: 84, qty: 10 },
  ];
  for (const p of demoProducts) {
    const { qty, ...data } = p;
    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: { ...data, trackSerials: false },
    });
    await prisma.stockLevel.upsert({
      where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
      update: {},
      create: { productId: product.id, warehouseId: warehouse.id, quantity: qty },
    });
  }

  console.log('Seed completed: admin user, warehouse, categories, sequences, settings, demo products.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
