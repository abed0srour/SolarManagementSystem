import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calcLine, round2 } from './calc';

/**
 * Shared builder for line items that may be composite bundles.
 *
 * Sales orders, quotations and invoices all carry the same item shape and the
 * same bundle rules, and they were drifting: sales orders understood bundles
 * while the other two silently dropped the components and mispriced the line.
 * One implementation removes the possibility of that divergence.
 *
 * A bundle header carries no product of its own — its price is the sum of its
 * components unless the admin fixes it — and only catalogue lines ever move
 * stock, which each caller enforces at its own confirm/receive step.
 */

export interface BuiltLine {
  productId: string | null;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  discountType: any;
  discountValue: number;
  lineTotal: number;
  isComposite: boolean;
  autoPrice: boolean;
  _totals: { net: number; lineTotal: number };
  _subItems: {
    productId: string | null;
    description: string;
    quantity: number;
    unit: string | null;
    unitPrice: number;
    lineTotal: number;
  }[];
}

/**
 * Resolve prices and names from the catalogue, then build every line.
 *
 * `priceField` differs by document: a purchase invoice prices its lines at cost,
 * everything else at sale price.
 */
export async function buildCompositeItems(
  prisma: Prisma.TransactionClient | any,
  items: any[],
  priceField: 'salePrice' | 'costPrice' = 'salePrice',
): Promise<BuiltLine[]> {
  const productIds = items
    .flatMap((i) => [i.productId, ...(i.subItems ?? []).map((s: any) => s.productId)])
    .filter(Boolean);

  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, salePrice: true, costPrice: true, name: true },
      })
    : [];
  const priceById = new Map(products.map((p: any) => [p.id, Number(p[priceField])]));
  const nameById = new Map(products.map((p: any) => [p.id, p.name as string]));

  const priceOf = (i: any): number => {
    const base = i.productId ? priceById.get(i.productId) : undefined;
    if (i.productId && base === undefined) throw new NotFoundException(`Product ${i.productId} not found`);
    const unitPrice = i.unitPrice === undefined || i.unitPrice === null ? ((base as number) ?? 0) : Number(i.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new BadRequestException('Unit price must be zero or greater');
    }
    return unitPrice;
  };

  return items.map((i) => {
    const isComposite = Boolean(i.isComposite);
    const subs = isComposite ? (i.subItems ?? []) : [];

    const builtSubs = subs.map((s: any) => {
      const unitPrice = priceOf(s);
      const quantity = Number(s.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity < 0) {
        throw new BadRequestException('Sub-item quantity must be zero or greater');
      }
      // Snapshot the name so the pick-list still reads correctly after a rename.
      const description = s.description?.trim() || (s.productId ? nameById.get(s.productId) : undefined);
      if (!description) throw new BadRequestException('Each bundle component needs a product');
      return {
        productId: s.productId ?? null,
        description,
        quantity,
        unit: s.unit ?? null,
        unitPrice,
        lineTotal: round2(quantity * unitPrice),
      };
    });

    if (isComposite && !i.description?.trim()) throw new BadRequestException('A bundle needs a name');

    const autoPrice = i.autoPrice !== false;
    const componentsTotal = round2(builtSubs.reduce((s: number, b: any) => s + b.lineTotal, 0));
    // A bundle with no components supplied cannot be priced from them — that
    // happens when a document copies an already-priced bundle and attaches its
    // components separately. Fall back to the given price rather than billing 0,
    // while keeping the admin's autoPrice intent on the row.
    const derivable = autoPrice && builtSubs.length > 0;
    const unitPrice = isComposite && derivable ? componentsTotal : priceOf(i);
    const quantity = isComposite ? Number(i.quantity ?? 1) : Number(i.quantity);

    const t = calcLine({ ...i, quantity, unitPrice });
    return {
      productId: isComposite ? null : (i.productId ?? null),
      description: i.description ?? null,
      quantity,
      unit: i.unit ?? null,
      unitPrice,
      discountType: i.discountType ?? null,
      discountValue: i.discountValue ?? 0,
      lineTotal: t.lineTotal,
      isComposite,
      autoPrice,
      _totals: t,
      _subItems: builtSubs,
    };
  });
}

/**
 * Attach each bundle's components once the parent rows exist and have ids.
 *
 * Matching on description is what the parent lookup has to use: the rows were
 * just created in bulk, so there is no other handle back to the input. Bundle
 * names are unique within a document in practice, and a collision only merges
 * two identically-named bundles rather than corrupting anything.
 */
export async function writeSubItems(
  table: any,
  ownerField: string,
  ownerId: string,
  built: BuiltLine[],
  extra: Record<string, unknown> = {},
) {
  if (!built.some((b) => b._subItems?.length)) return;
  const parents = await table.findMany({
    where: { [ownerField]: ownerId, isComposite: true, parentItemId: null },
    select: { id: true, description: true },
  });
  for (const b of built) {
    if (!b._subItems?.length) continue;
    const parent = parents.find((p: any) => p.description === b.description);
    if (!parent) continue;
    await table.createMany({
      data: b._subItems.map((s) => ({ ...s, ...extra, [ownerField]: ownerId, parentItemId: parent.id })),
    });
  }
}
