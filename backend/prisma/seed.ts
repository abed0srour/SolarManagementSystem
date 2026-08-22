import { AttributeType, PrismaClient } from '@prisma/client';

/**
 * Reference and demo data for ONE store.
 *
 * Accounts are no longer created here — identity moved to Supabase Auth, and a
 * seed script has no business writing password hashes. Use `supabase db reset`
 * (which runs supabase/seed.sql) for local accounts, or
 * `npm run superadmin:create` for a real environment.
 *
 * What is left is catalogue scaffolding: the categories, attribute definitions,
 * numbering and demo stock a store needs before it is usable. All of it is
 * per-tenant now, so the target store is named explicitly rather than assumed:
 *
 *     SEED_TENANT_SLUG=acme npm run prisma:seed
 *
 * Uses a plain PrismaClient with no tenant extension, so every write states its
 * `tenantId` outright. That is the right trade for a script: there is no request
 * to infer a tenant from, and being forced to name it means the seed cannot
 * quietly write into the wrong store.
 */
const prisma = new PrismaClient();

const TENANT_SLUG = process.env.SEED_TENANT_SLUG ?? 'default';

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    throw new Error(
      `No store with slug "${TENANT_SLUG}". Create one from the super admin dashboard, or run \`supabase db reset\` to get the default store.`,
    );
  }
  const tenantId = tenant.id;
  console.log(`Seeding store: ${tenant.name} (${tenant.slug})`);

  // Default warehouse
  const warehouse = await prisma.warehouse.upsert({
    where: { tenantId_name: { tenantId, name: 'Main Warehouse' } },
    update: {},
    create: { tenantId, name: 'Main Warehouse', isDefault: true },
  });

  // Number sequences — each store counts its own documents from 1.
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
      where: { tenantId_entity: { tenantId, entity } },
      update: {},
      create: { tenantId, entity, prefix, nextNumber: 1, padding: 5 },
    });
  }

  // Settings
  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key: 'company' } },
    update: {},
    create: {
      tenantId,
      key: 'company',
      value: { name: tenant.name, address: '', phone: '', email: '', taxNumber: '', logoUrl: '' },
    },
  });
  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key: 'finance' } },
    update: {},
    create: {
      tenantId,
      key: 'finance',
      value: { defaultTaxRatePct: 11, baseCurrency: 'USD', secondaryCurrency: 'LBP', exchangeRate: 89500 },
    },
  });

  // Categories with attribute definitions
  const solar = await prisma.category.upsert({
    where: { tenantId_name: { tenantId, name: 'Solar Panels' } },
    update: {},
    create: { tenantId, name: 'Solar Panels', description: 'Photovoltaic solar panels' },
  });
  const inverters = await prisma.category.upsert({
    where: { tenantId_name: { tenantId, name: 'Inverters' } },
    update: {},
    create: { tenantId, name: 'Inverters', description: 'Solar inverters' },
  });
  const batteries = await prisma.category.upsert({
    where: { tenantId_name: { tenantId, name: 'Batteries' } },
    update: {},
    create: { tenantId, name: 'Batteries', description: 'Energy storage batteries' },
  });

  type AttrDef = { name: string; label: string; type: AttributeType; unit?: string; options?: string[]; required?: boolean };

  async function subCatWithAttrs(categoryId: string, name: string, attrs: AttrDef[]) {
    const sub = await prisma.subCategory.upsert({
      where: { categoryId_name: { categoryId, name } },
      update: {},
      create: { tenantId, categoryId, name },
    });
    let order = 0;
    for (const a of attrs) {
      await prisma.attributeDefinition.upsert({
        where: { subCategoryId_name: { subCategoryId: sub.id, name: a.name } },
        update: {},
        create: {
          tenantId,
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
      where: { tenantId_sku: { tenantId, sku: p.sku } },
      update: {},
      create: { ...data, tenantId, trackSerials: false },
    });
    await prisma.stockLevel.upsert({
      where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
      update: {},
      create: { tenantId, productId: product.id, warehouseId: warehouse.id, quantity: qty },
    });
  }

  console.log(`Seed completed for ${tenant.name}: warehouse, categories, sequences, settings, demo products.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
