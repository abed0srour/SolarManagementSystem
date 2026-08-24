import {
  AttributeType,
  ClaimStatus,
  ClientTier,
  ClientType,
  ContractStatus,
  DiscountType,
  ExpenseCategory,
  InstallationStatus,
  InvoiceStatus,
  InvoiceType,
  MovementType,
  PaymentDirection,
  PaymentMethod,
  PrismaClient,
  QuotationStatus,
  Role,
  SalesOrderStatus,
  ServiceJobStatus,
  ServiceJobType,
  SystemType,
  TenantStatus,
  UnitStatus,
} from '@prisma/client';

/**
 * ============================================================================
 * Staging & Local Environment Realistic Data Seeder
 * ============================================================================
 *
 * Populates Staging or Local databases with multi-tenant realistic dummy data:
 *   - Multiple stores / tenants (Beirut HQ, Zahle Branch, North Operations)
 *   - Staff user records & permission mappings
 *   - Warehouses & stock levels with tracked serial numbers
 *   - Rich category hierarchy with attribute definitions
 *   - Full sales cycle: Quotations -> Sales Orders -> Invoices -> Payments
 *   - Suppliers, purchase orders, client addresses
 *   - Solar installations, maintenance contracts, and warranty claims
 *
 * SAFETY GUARDS:
 * Refuses to run if NODE_ENV is production or if DATABASE_URL appears to target
 * a production cluster without explicit override.
 */

const prisma = new PrismaClient();

function assertSafeEnvironment() {
  const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase();
  const dbUrl = process.env.DATABASE_URL ?? '';
  const directUrl = process.env.DIRECT_URL ?? '';
  const allowProd = process.env.ALLOW_PRODUCTION_SEED === 'true';

  if (nodeEnv === 'production' && !allowProd) {
    throw new Error(
      '🚨 ABORTED: Attempted to run staging seeder in PRODUCTION environment! ' +
        'To force seeding on this database, set ALLOW_PRODUCTION_SEED=true.',
    );
  }

  const isSuspiciousUrl =
    dbUrl.includes('prod') ||
    directUrl.includes('prod') ||
    dbUrl.includes('live') ||
    directUrl.includes('live');

  if (isSuspiciousUrl && !allowProd) {
    throw new Error(
      '🚨 ABORTED: DATABASE_URL contains "prod" or "live" keywords. ' +
        'Refusing to run staging seed against potential production target without ALLOW_PRODUCTION_SEED=true.',
    );
  }
}

interface TenantSeedConfig {
  id: string;
  name: string;
  slug: string;
  contactEmail: string;
  contactPhone: string;
  currency: string;
  exchangeRate: number;
}

const DEMO_TENANTS: TenantSeedConfig[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'SolarTech Solutions Beirut',
    slug: 'default',
    contactEmail: 'contact@solartech-beirut.local',
    contactPhone: '+961 1 200300',
    currency: 'USD',
    exchangeRate: 89500,
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    name: 'GreenEnergy Bekaa & Zahle',
    slug: 'greenenergy-zahle',
    contactEmail: 'info@greenenergy-zahle.local',
    contactPhone: '+961 8 800900',
    currency: 'USD',
    exchangeRate: 89500,
  },
];

async function seedTenant(tConfig: TenantSeedConfig) {
  console.log(`\n========================================================`);
  console.log(`🌱 Seeding Tenant: ${tConfig.name} [slug: ${tConfig.slug}]`);
  console.log(`========================================================`);

  const tenant = await prisma.tenant.upsert({
    where: { id: tConfig.id },
    update: {
      name: tConfig.name,
      slug: tConfig.slug,
      status: TenantStatus.ACTIVE,
      contactEmail: tConfig.contactEmail,
      contactPhone: tConfig.contactPhone,
    },
    create: {
      id: tConfig.id,
      name: tConfig.name,
      slug: tConfig.slug,
      status: TenantStatus.ACTIVE,
      contactEmail: tConfig.contactEmail,
      contactPhone: tConfig.contactPhone,
      maxUsers: 50,
      maxProducts: 1000,
      maxClients: 5000,
    },
  });
  const tenantId = tenant.id;

  // 1. Warehouses
  const mainWarehouse = await prisma.warehouse.upsert({
    where: { tenantId_name: { tenantId, name: 'Main Central Warehouse' } },
    update: {},
    create: {
      tenantId,
      name: 'Main Central Warehouse',
      address: `${tConfig.name} Industrial Zone, Lot 44`,
      isDefault: true,
      isActive: true,
    },
  });

  const secondaryWarehouse = await prisma.warehouse.upsert({
    where: { tenantId_name: { tenantId, name: 'Showroom & Quick Dispatch' } },
    update: {},
    create: {
      tenantId,
      name: 'Showroom & Quick Dispatch',
      address: `${tConfig.name} Main Commercial Blvd`,
      isDefault: false,
      isActive: true,
    },
  });

  // 2. Number sequences
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
      create: { tenantId, entity, prefix, nextNumber: 100, padding: 5 },
    });
  }

  // 3. Settings
  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key: 'company' } },
    update: {},
    create: {
      tenantId,
      key: 'company',
      value: {
        name: tConfig.name,
        address: `${tConfig.name} Commercial Tower, Floor 4`,
        phone: tConfig.contactPhone,
        email: tConfig.contactEmail,
        taxNumber: `TAX-LB-${tenantId.substring(0, 8).toUpperCase()}`,
        logoUrl: '',
      },
    },
  });

  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key: 'finance' } },
    update: {},
    create: {
      tenantId,
      key: 'finance',
      value: {
        defaultTaxRatePct: 11,
        baseCurrency: tConfig.currency,
        secondaryCurrency: 'LBP',
        exchangeRate: tConfig.exchangeRate,
      },
    },
  });

  // 4. Staff Users & Profiles
  const staffEmail = `admin@${tConfig.slug}.solarstore.local`;
  const storeAdminUser = await prisma.user.upsert({
    where: { email: staffEmail },
    update: { tenantId, role: Role.ADMIN },
    create: {
      email: staffEmail,
      name: `${tConfig.name} Administrator`,
      role: Role.ADMIN,
      tenantId,
      isActive: true,
    },
  });

  const salesRepUser = await prisma.user.upsert({
    where: { email: `sales@${tConfig.slug}.solarstore.local` },
    update: { tenantId, role: Role.STAFF },
    create: {
      email: `sales@${tConfig.slug}.solarstore.local`,
      name: 'Samir Khoury (Senior Sales)',
      role: Role.STAFF,
      tenantId,
      isActive: true,
    },
  });

  // 5. Product Categories & Technical Attributes
  const solarCat = await prisma.category.upsert({
    where: { tenantId_name: { tenantId, name: 'Solar Panels' } },
    update: {},
    create: { tenantId, name: 'Solar Panels', description: 'Tier-1 Photovoltaic Modules' },
  });
  const inverterCat = await prisma.category.upsert({
    where: { tenantId_name: { tenantId, name: 'Inverters' } },
    update: {},
    create: { tenantId, name: 'Inverters', description: 'Hybrid and Off-Grid Inverters' },
  });
  const batteryCat = await prisma.category.upsert({
    where: { tenantId_name: { tenantId, name: 'Batteries' } },
    update: {},
    create: { tenantId, name: 'Batteries', description: 'LiFePO4 & Gel Storage' },
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

  const monoSub = await subCatWithAttrs(solarCat.id, 'Monocrystalline N-Type', [
    { name: 'wattage', label: 'Rated Power', type: 'NUMBER', unit: 'W', required: true },
    { name: 'efficiency', label: 'Module Efficiency', type: 'NUMBER', unit: '%' },
    { name: 'bifacial', label: 'Bifacial Factor', type: 'TEXT' },
  ]);

  const hybridSub = await subCatWithAttrs(inverterCat.id, 'Hybrid Inverters', [
    { name: 'capacityKw', label: 'Output Capacity', type: 'NUMBER', unit: 'kW', required: true },
    { name: 'phase', label: 'Grid Phase', type: 'SELECT', options: ['Single-phase', 'Three-phase'] },
    { name: 'mpptTrackers', label: 'MPPT Trackers Count', type: 'NUMBER' },
  ]);

  const lifepo4Sub = await subCatWithAttrs(batteryCat.id, 'Lithium (LiFePO4)', [
    { name: 'capacityKwh', label: 'Energy Capacity', type: 'NUMBER', unit: 'kWh', required: true },
    { name: 'voltage', label: 'Nominal Voltage', type: 'NUMBER', unit: 'V', required: true },
    { name: 'cycleLife', label: 'Cycle Life (80% DoD)', type: 'NUMBER', unit: 'cycles' },
  ]);

  // 6. Products & Warehouse Stock
  const demoProducts = [
    {
      sku: `${tConfig.slug.toUpperCase().substring(0, 4)}-JK-585`,
      name: 'Jinko Tiger Neo 585W N-Type',
      brand: 'Jinko Solar',
      model: 'JKM585N-72HL4-BDV',
      subCategoryId: monoSub.id,
      attributes: { wattage: 585, efficiency: 22.65, bifacial: '75%' },
      costPrice: 92,
      salePrice: 130,
      warrantyMonths: 144,
      qtyMain: 120,
      qtyShowroom: 20,
    },
    {
      sku: `${tConfig.slug.toUpperCase().substring(0, 4)}-LG-560`,
      name: 'LONGi Hi-MO 6 Explorer 560W',
      brand: 'LONGi Solar',
      model: 'LR5-72HTH-560M',
      subCategoryId: monoSub.id,
      attributes: { wattage: 560, efficiency: 21.8 },
      costPrice: 85,
      salePrice: 122,
      warrantyMonths: 144,
      qtyMain: 80,
      qtyShowroom: 15,
    },
    {
      sku: `${tConfig.slug.toUpperCase().substring(0, 4)}-DY-8K`,
      name: 'Deye 8kW Hybrid Inverter (EU)',
      brand: 'Deye',
      model: 'SUN-8K-SG01LP1-EU',
      subCategoryId: hybridSub.id,
      attributes: { capacityKw: 8, phase: 'Single-phase', mpptTrackers: 2 },
      costPrice: 940,
      salePrice: 1280,
      warrantyMonths: 60,
      qtyMain: 14,
      qtyShowroom: 4,
    },
    {
      sku: `${tConfig.slug.toUpperCase().substring(0, 4)}-DY-12K`,
      name: 'Deye 12kW 3-Phase Hybrid Inverter',
      brand: 'Deye',
      model: 'SUN-12K-SG04LP3-EU',
      subCategoryId: hybridSub.id,
      attributes: { capacityKw: 12, phase: 'Three-phase', mpptTrackers: 2 },
      costPrice: 1650,
      salePrice: 2150,
      warrantyMonths: 60,
      qtyMain: 8,
      qtyShowroom: 2,
    },
    {
      sku: `${tConfig.slug.toUpperCase().substring(0, 4)}-PY-5K`,
      name: 'Pylontech US5000 4.8kWh LiFePO4',
      brand: 'Pylontech',
      model: 'US5000-1C',
      subCategoryId: lifepo4Sub.id,
      attributes: { capacityKwh: 4.8, voltage: 48, cycleLife: 6000 },
      costPrice: 960,
      salePrice: 1320,
      warrantyMonths: 84,
      qtyMain: 22,
      qtyShowroom: 6,
    },
  ];

  const createdProducts: Record<string, any> = {};
  for (const p of demoProducts) {
    const { qtyMain, qtyShowroom, ...data } = p;
    const prod = await prisma.product.upsert({
      where: { tenantId_sku: { tenantId, sku: p.sku } },
      update: {},
      create: { ...data, tenantId, trackSerials: true },
    });
    createdProducts[p.sku] = prod;

    // Stock in main warehouse
    await prisma.stockLevel.upsert({
      where: { productId_warehouseId: { productId: prod.id, warehouseId: mainWarehouse.id } },
      update: {},
      create: { tenantId, productId: prod.id, warehouseId: mainWarehouse.id, quantity: qtyMain },
    });

    // Stock in showroom
    await prisma.stockLevel.upsert({
      where: { productId_warehouseId: { productId: prod.id, warehouseId: secondaryWarehouse.id } },
      update: {},
      create: { tenantId, productId: prod.id, warehouseId: secondaryWarehouse.id, quantity: qtyShowroom },
    });

    // Seed sample serial units
    for (let i = 1; i <= 3; i++) {
      const serial = `SN-${p.sku}-${i.toString().padStart(4, '0')}`;
      await prisma.productUnit.upsert({
        where: { tenantId_serialNumber: { tenantId, serialNumber: serial } },
        update: {},
        create: {
          tenantId,
          productId: prod.id,
          serialNumber: serial,
          status: UnitStatus.IN_STOCK,
          warehouseId: mainWarehouse.id,
          warrantyStartDate: new Date(),
          warrantyEndDate: new Date(Date.now() + 365 * 24 * 3600 * 1000 * 5),
        },
      });
    }
  }

  // 7. Suppliers
  const supplier = await prisma.supplier.upsert({
    where: { id: `supp-${tenantId.substring(0, 8)}` },
    update: {},
    create: {
      id: `supp-${tenantId.substring(0, 8)}`,
      tenantId,
      name: 'Levant Green Energy Suppliers S.A.L.',
      contactName: 'Nabil Haddad',
      email: 'sales@levant-energy.example',
      phone: '+961 1 555666',
      address: 'Beirut Port Free Trade Zone, Warehouse B',
      leadTimeDays: 14,
    },
  });

  // 8. Clients
  const commercialClient = await prisma.client.upsert({
    where: { id: `client-comm-${tenantId.substring(0, 8)}` },
    update: {},
    create: {
      id: `client-comm-${tenantId.substring(0, 8)}`,
      tenantId,
      name: 'Cedar Valley Agro-Industries',
      type: ClientType.BUSINESS,
      tier: ClientTier.WHOLESALE,
      email: 'facilities@cedarvalley.example',
      phone: '+961 8 501234',
      taxNumber: 'MOF-9988771',
      creditLimit: 50000,
    },
  });

  const residentialClient = await prisma.client.upsert({
    where: { id: `client-res-${tenantId.substring(0, 8)}` },
    update: {},
    create: {
      id: `client-res-${tenantId.substring(0, 8)}`,
      tenantId,
      name: 'Dr. Ziad Barakat (Villa Project)',
      type: ClientType.INDIVIDUAL,
      tier: ClientTier.RETAIL,
      email: 'ziad.barakat@medexample.com',
      phone: '+961 3 123456',
      creditLimit: 5000,
    },
  });

  // Client Addresses
  await prisma.clientAddress.upsert({
    where: { id: `addr-comm-${tenantId.substring(0, 8)}` },
    update: {},
    create: {
      id: `addr-comm-${tenantId.substring(0, 8)}`,
      tenantId,
      clientId: commercialClient.id,
      label: 'Factory & Cold Storage',
      line1: 'Zahle Highway, Agro District',
      city: 'Zahle',
      isBilling: true,
      isInstallation: true,
    },
  });

  await prisma.clientAddress.upsert({
    where: { id: `addr-res-${tenantId.substring(0, 8)}` },
    update: {},
    create: {
      id: `addr-res-${tenantId.substring(0, 8)}`,
      tenantId,
      clientId: residentialClient.id,
      label: 'Mountain Villa',
      line1: 'Broummana Hills Road, Villa 12',
      city: 'Broummana',
      isBilling: true,
      isInstallation: true,
    },
  });

  // 9. Quotation -> Sales Order -> Invoice -> Payment Flow
  const qNumber = `QT-2026-${tenantId.substring(0, 4).toUpperCase()}-01`;
  const quotation = await prisma.quotation.upsert({
    where: { tenantId_number: { tenantId, number: qNumber } },
    update: {},
    create: {
      tenantId,
      number: qNumber,
      clientId: residentialClient.id,
      status: QuotationStatus.ACCEPTED,
      validUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      createdById: salesRepUser.id,
      subtotal: 5180,
      total: 5180,
      notes: 'Turnkey 8kW Hybrid Solar Installation with 9.6kWh LiFePO4 Storage',
      items: {
        create: [
          {
            tenantId,
            description: 'Jinko Tiger Neo 585W N-Type Panels (x12)',
            quantity: 12,
            unitPrice: 130,
            lineTotal: 1560,
          },
          {
            tenantId,
            description: 'Deye 8kW Hybrid Inverter (EU Single-phase)',
            quantity: 1,
            unitPrice: 1280,
            lineTotal: 1280,
          },
          {
            tenantId,
            description: 'Pylontech US5000 4.8kWh Battery Storage (x2 Modules)',
            quantity: 2,
            unitPrice: 1320,
            lineTotal: 2640,
          },
          {
            tenantId,
            discountType: DiscountType.FIXED,
            discountValue: 300,
            description: 'Turnkey Mounting Rails, DC Surge Protection & Commissioning Discount',
            quantity: 1,
            unitPrice: -300,
            lineTotal: -300,
          },
        ],
      },
    },
  });

  const soNumber = `SO-2026-${tenantId.substring(0, 4).toUpperCase()}-01`;
  const salesOrder = await prisma.salesOrder.upsert({
    where: { tenantId_number: { tenantId, number: soNumber } },
    update: {},
    create: {
      tenantId,
      number: soNumber,
      clientId: residentialClient.id,
      quotationId: quotation.id,
      warehouseId: mainWarehouse.id,
      status: SalesOrderStatus.CONFIRMED,
      orderDate: new Date(),
      subtotal: 5180,
      total: 5180,
      createdById: salesRepUser.id,
      items: {
        create: [
          {
            tenantId,
            description: 'Jinko Tiger Neo 585W N-Type Panels (x12)',
            quantity: 12,
            unitPrice: 130,
            lineTotal: 1560,
            deliveredQty: 12,
          },
          {
            tenantId,
            description: 'Deye 8kW Hybrid Inverter (EU Single-phase)',
            quantity: 1,
            unitPrice: 1280,
            lineTotal: 1280,
            deliveredQty: 1,
          },
          {
            tenantId,
            description: 'Pylontech US5000 4.8kWh Battery Storage (x2)',
            quantity: 2,
            unitPrice: 1320,
            lineTotal: 2640,
            deliveredQty: 2,
          },
        ],
      },
    },
  });

  const invNumber = `INV-2026-${tenantId.substring(0, 4).toUpperCase()}-01`;
  const invoice = await prisma.invoice.upsert({
    where: { tenantId_number: { tenantId, number: invNumber } },
    update: {},
    create: {
      tenantId,
      number: invNumber,
      type: InvoiceType.SALE,
      clientId: residentialClient.id,
      salesOrderId: salesOrder.id,
      status: InvoiceStatus.PAID,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 15 * 24 * 3600 * 1000),
      currency: 'USD',
      subtotal: 5180,
      total: 5180,
      paidAmount: 5180,
      createdById: storeAdminUser.id,
      items: {
        create: [
          {
            tenantId,
            description: '8kW Hybrid Residential Solar Package',
            quantity: 1,
            unitPrice: 5180,
            lineTotal: 5180,
          },
        ],
      },
    },
  });

  const payNumber = `PAY-2026-${tenantId.substring(0, 4).toUpperCase()}-01`;
  await prisma.payment.upsert({
    where: { tenantId_number: { tenantId, number: payNumber } },
    update: {},
    create: {
      tenantId,
      number: payNumber,
      direction: PaymentDirection.INCOMING,
      invoiceId: invoice.id,
      clientId: residentialClient.id,
      method: PaymentMethod.CASH,
      amount: 5180,
      currency: 'USD',
      paymentDate: new Date(),
      reference: 'CASH-RECEIPT-88912',
      createdById: storeAdminUser.id,
    },
  });

  // 10. Solar Installation & Maintenance Contract
  const instNumber = `INST-2026-${tenantId.substring(0, 4).toUpperCase()}-01`;
  const installation = await prisma.installation.upsert({
    where: { tenantId_number: { tenantId, number: instNumber } },
    update: {},
    create: {
      tenantId,
      number: instNumber,
      clientId: residentialClient.id,
      salesOrderId: salesOrder.id,
      systemType: SystemType.HYBRID,
      capacityKw: 8.0,
      panelCount: 12,
      batteryKwh: 9.6,
      status: InstallationStatus.COMMISSIONED,
      siteAddress: 'Broummana Hills Road, Villa 12',
      notes: 'Tiled Roof (South-Facing 32°)',
      commissionedAt: new Date(),
      createdById: storeAdminUser.id,
    },
  });

  const mcNumber = `MC-2026-${tenantId.substring(0, 4).toUpperCase()}-01`;
  await prisma.maintenanceContract.upsert({
    where: { tenantId_number: { tenantId, number: mcNumber } },
    update: {},
    create: {
      tenantId,
      number: mcNumber,
      installationId: installation.id,
      status: ContractStatus.ACTIVE,
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 24 * 3600 * 1000 * 2), // 2-year contract
      visitsPerYear: 2,
      pricePerYear: 350,
      nextVisitDate: new Date(Date.now() + 180 * 24 * 3600 * 1000),
      notes: 'Biannual panel wash, thermal imaging check, and inverter firmware upgrade',
    },
  });

  // 11. Warranty Claim
  const wcNumber = `WC-2026-${tenantId.substring(0, 4).toUpperCase()}-01`;
  await prisma.warrantyClaim.upsert({
    where: { tenantId_number: { tenantId, number: wcNumber } },
    update: {},
    create: {
      tenantId,
      number: wcNumber,
      clientId: residentialClient.id,
      productId: createdProducts[demoProducts[2].sku].id,
      invoiceId: invoice.id,
      issue: 'Inverter communication module Wi-Fi dropped after thunderstorm',
      status: ClaimStatus.OPEN,
      createdById: salesRepUser.id,
    },
  });

  // 12. Operating Expenses
  const expNumber = `EXP-2026-${tenantId.substring(0, 4).toUpperCase()}-01`;
  await prisma.expense.upsert({
    where: { tenantId_number: { tenantId, number: expNumber } },
    update: {},
    create: {
      tenantId,
      number: expNumber,
      category: ExpenseCategory.RENT,
      amount: 1400,
      currency: 'USD',
      expenseDate: new Date(),
      description: 'Monthly Warehouse Facility Lease',
      createdById: storeAdminUser.id,
    },
  });

  console.log(`✅ Tenant ${tConfig.name} seeded successfully.`);
}

async function main() {
  assertSafeEnvironment();
  console.log('🚀 Starting Staging & Local Environment Seed...');

  for (const tenantConfig of DEMO_TENANTS) {
    await seedTenant(tenantConfig);
  }

  console.log('\n🎉 All staging & local demo data seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeder encountered an error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
