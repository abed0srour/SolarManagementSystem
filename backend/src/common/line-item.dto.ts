import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

/**
 * One component inside a composite bundle.
 *
 * Sub-items are descriptive: they appear on the internal pick-list and may be
 * itemised on an invoice, but they never move stock. That is why `quantity` is
 * a plain number rather than an integer — cable and conduit are sold by the
 * metre, and 12.5 m is a legitimate quantity.
 */
export class SubItemDto {
  /** The catalogue product this component is. Its stock is drawn on confirm. */
  @IsOptional()
  @IsString()
  productId?: string;

  /** Snapshot of the product name; filled in from the catalogue when omitted. */
  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  /** Unit of measure: pcs, set, m, ft… */
  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;
}

export class LineItemDto {
  /** Absent on a composite bundle header, which is named by hand instead. */
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Not @IsInt: a bundle's own quantity is normally 1, and catalogue lines are
  // still whole numbers in practice. Fractional stock is rejected downstream.
  @IsNumber()
  @Min(0)
  quantity: number;

  @IsOptional()
  @IsString()
  unit?: string;

  // Optional override of the product's sale price for this line only. May be
  // higher than list price (a markup) or lower. Omitted means "use the
  // product's current sale price". Never negative.
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsIn(['PERCENT', 'FIXED'])
  discountType?: 'PERCENT' | 'FIXED';

  /**
   * May be negative. A negative discount is a surcharge that adds to the line.
   * `calcLine` handles both directions and floors the result at zero.
   */
  @IsOptional()
  @IsNumber()
  discountValue?: number;

  /** Marks this line as a bundle header holding `subItems`. */
  @IsOptional()
  @IsBoolean()
  isComposite?: boolean;

  /** When true (the default) the bundle price is the sum of its components. */
  @IsOptional()
  @IsBoolean()
  autoPrice?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubItemDto)
  subItems?: SubItemDto[];
}
