import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class LineItemDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  // Optional: sales orders ignore it entirely (the server snapshots the
  // product's current sale price); quotations/invoices may still send it.
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsIn(['PERCENT', 'FIXED'])
  discountType?: 'PERCENT' | 'FIXED';

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;
}
