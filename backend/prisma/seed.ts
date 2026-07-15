import { PrismaClient, AttributeType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Admin user
  const passwordHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@solarstore.local' },
    update: {},
    create: { email: 'admin@solarstore.local', passwordHash, name: 'Admin', role: 'ADMIN' },
  });

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

  await subCatWithAttrs(solar.id, 'Monocrystalline', [
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
  await subCatWithAttrs(inverters.id, 'Hybrid', inverterAttrs);

  const batteryAttrs: AttrDef[] = [
    { name: 'capacityAh', label: 'Capacity', type: 'NUMBER', unit: 'Ah', required: true },
    { name: 'capacityKwh', label: 'Energy', type: 'NUMBER', unit: 'kWh' },
    { name: 'voltage', label: 'Voltage', type: 'NUMBER', unit: 'V', required: true },
    { name: 'cycleLife', label: 'Cycle Life', type: 'NUMBER', unit: 'cycles' },
  ];
  await subCatWithAttrs(batteries.id, 'Lithium (LiFePO4)', batteryAttrs);
  await subCatWithAttrs(batteries.id, 'Lithium (Li-ion)', batteryAttrs);
  await subCatWithAttrs(batteries.id, 'Lead-acid (Flooded)', batteryAttrs);
  await subCatWithAttrs(batteries.id, 'Lead-acid (AGM)', batteryAttrs);
  await subCatWithAttrs(batteries.id, 'Lead-acid (Gel)', batteryAttrs);

  console.log('Seed completed: admin user, warehouse, categories, sequences, settings.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
