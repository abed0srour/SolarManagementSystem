'use client';

import { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Plus, Trash2, Sparkles, Layers, RefreshCw, Check, X, AlertCircle,
  Tag, Barcode, DollarSign, Image as ImageIcon, ChevronDown, ChevronRight,
} from 'lucide-react';
import { api, errMsg, fmtMoney } from '../lib/api';
import { invalidateCache } from '../lib/cache';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

export type DynamicType = 'STRING' | 'INTEGER' | 'DECIMAL' | 'FLOAT' | 'BOOLEAN';

export interface AttributeItem {
  id?: string;
  name: string;
  type: DynamicType;
  unit?: string;
  isFreeForm: boolean;
  permittedValues: any[];
  newValueInput?: string;
}

export interface GeneratedVariant {
  id?: string;
  sku: string;
  name: string;
  salePrice: number;
  costPrice?: number;
  barcode?: string;
  imageUrl?: string;
  variantAttributes: Record<string, any>;
  enabled: boolean;
  stock?: number;
}

interface ProductVariantManagerProps {
  productId?: string;
  baseSku: string;
  baseName: string;
  baseSalePrice: number;
  baseCostPrice?: number;
  baseImageUrl?: string;
  initialAttributes?: any[];
  initialVariants?: any[];
  onVariantsUpdated?: (variants: any[]) => void;
}

export default function ProductVariantManager({
  productId,
  baseSku,
  baseName,
  baseSalePrice,
  baseCostPrice = 0,
  baseImageUrl = '',
  initialAttributes = [],
  initialVariants = [],
  onVariantsUpdated,
}: ProductVariantManagerProps) {
  // 1. Dynamic Attribute Definitions
  const [attributes, setAttributes] = useState<AttributeItem[]>(() => {
    if (initialAttributes && initialAttributes.length > 0) {
      return initialAttributes.map((a: any) => ({
        id: a.id,
        name: a.name,
        type: a.type || 'STRING',
        unit: a.unit || '',
        isFreeForm: Boolean(a.isFreeForm),
        permittedValues: Array.isArray(a.permittedValues) ? a.permittedValues : [],
        newValueInput: '',
      }));
    }
    return [];
  });

  // 2. Generated / Existing Variants
  const [variants, setVariants] = useState<GeneratedVariant[]>(() => {
    if (initialVariants && initialVariants.length > 0) {
      return initialVariants.map((v: any) => ({
        id: v.id,
        sku: v.sku,
        name: v.name,
        salePrice: Number(v.salePrice),
        costPrice: v.costPrice !== undefined ? Number(v.costPrice) : undefined,
        barcode: v.barcode || '',
        imageUrl: v.imageUrl || '',
        variantAttributes: typeof v.variantAttributes === 'object' && v.variantAttributes !== null ? v.variantAttributes : {},
        enabled: true,
        stock: v.stockLevels ? v.stockLevels.reduce((acc: number, sl: any) => acc + (sl.quantity || 0), 0) : 0,
      }));
    }
    return [];
  });

  const [saving, setSaving] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);

  // Load existing variants if productId is provided
  useEffect(() => {
    if (!productId) return;
    setLoadingExisting(true);
    api
      .get(`/products/${productId}/variants`)
      .then((res) => {
        if (res.data) {
          if (res.data.attributes) {
            setAttributes(
              res.data.attributes.map((a: any) => ({
                id: a.id,
                name: a.name,
                type: a.type || 'STRING',
                unit: a.unit || '',
                isFreeForm: Boolean(a.isFreeForm),
                permittedValues: Array.isArray(a.permittedValues) ? a.permittedValues : [],
                newValueInput: '',
              })),
            );
          }
          if (res.data.variants) {
            setVariants(
              res.data.variants.map((v: any) => ({
                id: v.id,
                sku: v.sku,
                name: v.name,
                salePrice: Number(v.salePrice),
                costPrice: v.costPrice !== undefined ? Number(v.costPrice) : undefined,
                barcode: v.barcode || '',
                imageUrl: v.imageUrl || '',
                variantAttributes: typeof v.variantAttributes === 'object' && v.variantAttributes !== null ? v.variantAttributes : {},
                enabled: true,
                stock: v.stockLevels ? v.stockLevels.reduce((acc: number, sl: any) => acc + (sl.quantity || 0), 0) : 0,
              })),
            );
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoadingExisting(false));
  }, [productId]);

  // Attribute Handlers
  const addAttribute = () => {
    setAttributes([
      ...attributes,
      {
        name: '',
        type: 'STRING',
        unit: '',
        isFreeForm: false,
        permittedValues: [],
        newValueInput: '',
      },
    ]);
  };

  const removeAttribute = (index: number) => {
    setAttributes(attributes.filter((_, i) => i !== index));
  };

  const updateAttribute = (index: number, updates: Partial<AttributeItem>) => {
    const next = [...attributes];
    next[index] = { ...next[index], ...updates };
    setAttributes(next);
  };

  // Validate and parse an attribute value based on its dynamic type
  const parseValueForType = (val: string, type: DynamicType): { valid: boolean; value: any; error?: string } => {
    const trimmed = String(val).trim();
    if (!trimmed) return { valid: false, value: null, error: 'Value cannot be empty' };

    switch (type) {
      case 'INTEGER': {
        const num = Number(trimmed);
        if (!Number.isInteger(num)) {
          return { valid: false, value: null, error: 'Must be an integer (e.g. 10, 50, 100)' };
        }
        return { valid: true, value: num };
      }
      case 'DECIMAL':
      case 'FLOAT': {
        const num = Number(trimmed);
        if (isNaN(num) || !Number.isFinite(num)) {
          return { valid: false, value: null, error: 'Must be a valid number (e.g. 4.0, 2.5)' };
        }
        return { valid: true, value: num };
      }
      case 'BOOLEAN': {
        const lower = trimmed.toLowerCase();
        if (['true', 'yes', '1'].includes(lower)) return { valid: true, value: true };
        if (['false', 'no', '0'].includes(lower)) return { valid: true, value: false };
        return { valid: false, value: null, error: 'Must be True or False' };
      }
      case 'STRING':
      default:
        return { valid: true, value: trimmed };
    }
  };

  const addPermittedValue = (attrIndex: number) => {
    const attr = attributes[attrIndex];
    const raw = attr.newValueInput ?? '';
    const { valid, value, error } = parseValueForType(raw, attr.type);
    if (!valid) {
      toast.error(error || 'Invalid value for selected data type');
      return;
    }

    if (attr.permittedValues.some((v) => String(v) === String(value))) {
      toast.error('Value already exists in permitted list');
      return;
    }

    updateAttribute(attrIndex, {
      permittedValues: [...attr.permittedValues, value],
      newValueInput: '',
    });
  };

  const removePermittedValue = (attrIndex: number, valIndex: number) => {
    const attr = attributes[attrIndex];
    updateAttribute(attrIndex, {
      permittedValues: attr.permittedValues.filter((_, i) => i !== valIndex),
    });
  };

  // Generate Cartesian Combinations of All Permitted Attributes
  const generateCombinations = () => {
    const activeAttrs = attributes.filter((a) => a.name.trim() && a.permittedValues.length > 0);
    if (activeAttrs.length === 0) {
      toast.error('Define at least one attribute with permitted values to generate combinations');
      return;
    }

    // Cartesian product helper
    const cartesian = (arrays: any[][]): any[][] => {
      return arrays.reduce((acc, curr) => acc.flatMap((c) => curr.map((n) => [...c, n])), [[]] as any[][]);
    };

    const valueArrays = activeAttrs.map((a) => a.permittedValues.map((v) => ({ name: a.name, value: v, unit: a.unit })));
    const combinations = cartesian(valueArrays);

    const safeBaseSku = (baseSku.trim() || 'PRODUCT').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const cleanBaseName = baseName.trim() || 'Product';

    const generated: GeneratedVariant[] = combinations.map((combo) => {
      const attrMap: Record<string, any> = {};
      const skuParts: string[] = [];
      const nameParts: string[] = [];

      combo.forEach((item: { name: string; value: any; unit?: string }) => {
        attrMap[item.name] = item.value;
        const valStr = String(item.value);
        const skuPart = valStr.toUpperCase().replace(/[^A-Z0-9]/g, '');
        skuParts.push(skuPart || 'VAL');
        nameParts.push(`${item.value}${item.unit ? ' ' + item.unit : ''}`);
      });

      const variantSku = `${safeBaseSku}-${skuParts.join('-')}`;
      const variantName = `${cleanBaseName} (${nameParts.join(' / ')})`;

      // Retain existing variant if SKU matches
      const existing = variants.find((v) => v.sku === variantSku);
      if (existing) {
        return {
          ...existing,
          variantAttributes: attrMap,
        };
      }

      return {
        sku: variantSku,
        name: variantName,
        salePrice: Number(baseSalePrice) || 0,
        costPrice: baseCostPrice ? Number(baseCostPrice) : undefined,
        barcode: '',
        imageUrl: baseImageUrl || '',
        variantAttributes: attrMap,
        enabled: true,
      };
    });

    setVariants(generated);
    toast.success(`Generated ${generated.length} variant combinations!`);
  };

  const updateVariant = (index: number, updates: Partial<GeneratedVariant>) => {
    const next = [...variants];
    next[index] = { ...next[index], ...updates };
    setVariants(next);
  };

  const removeVariant = (index: number) => {
    setVariants(variants.filter((_, i) => i !== index));
  };

  // Save All Attributes and Generated Variants to Server
  const saveVariantsToServer = async () => {
    if (!productId) {
      toast.error('Save the base product first before saving variants to the database');
      return;
    }

    const enabledVariants = variants.filter((v) => v.enabled);
    if (enabledVariants.length === 0) {
      toast.error('No enabled variants to save');
      return;
    }

    // Check SKU uniqueness
    const skus = new Set<string>();
    for (const v of enabledVariants) {
      if (!v.sku.trim()) {
        toast.error('All variants must have a valid SKU');
        return;
      }
      if (skus.has(v.sku.trim().toUpperCase())) {
        toast.error(`Duplicate SKU detected: "${v.sku}". All variants must have unique SKUs.`);
        return;
      }
      skus.add(v.sku.trim().toUpperCase());
    }

    setSaving(true);
    try {
      const payload = {
        attributes: attributes
          .filter((a) => a.name.trim())
          .map((a, idx) => ({
            name: a.name.trim(),
            type: a.type,
            unit: a.unit?.trim() || undefined,
            isFreeForm: a.isFreeForm,
            permittedValues: a.permittedValues,
            sortOrder: idx,
          })),
        variants: enabledVariants.map((v) => ({
          sku: v.sku.trim(),
          name: v.name.trim(),
          salePrice: Number(v.salePrice) || 0,
          costPrice: v.costPrice !== undefined ? Number(v.costPrice) : undefined,
          barcode: v.barcode?.trim() || undefined,
          imageUrl: v.imageUrl?.trim() || undefined,
          variantAttributes: v.variantAttributes,
        })),
      };

      const res = await api.post(`/products/${productId}/generate-variants`, payload);
      invalidateCache('products');
      toast.success(`Successfully saved ${enabledVariants.length} product variants!`);
      if (onVariantsUpdated && res.data?.variants) {
        onVariantsUpdated(res.data.variants);
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. ATTRIBUTES BUILDER CARD */}
      <Card className="overflow-hidden border shadow-xs">
        <CardHeader className="bg-muted/40 border-b py-3 px-4 flex flex-row items-center justify-between">
          <div className="space-y-0.5">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" />
              Dynamic Product Attributes & Specification Types
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Define custom attribute dimensions (e.g. Size, Color, Dimensions, Voltage) with dynamic data types.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={addAttribute} className="text-xs gap-1.5 shadow-2xs">
            <Plus className="h-3.5 w-3.5" /> Add Attribute
          </Button>
        </CardHeader>

        <CardContent className="p-4 space-y-4">
          {attributes.length === 0 ? (
            <div className="text-center py-8 border border-dashed rounded-xl space-y-2">
              <Tag className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <p className="text-xs font-medium text-muted-foreground">No custom attributes defined yet</p>
              <p className="text-[11px] text-muted-foreground/80 max-w-sm mx-auto">
                Add attributes like <span className="font-semibold">Color</span> (String), <span className="font-semibold">Capacity</span> (Integer), or <span className="font-semibold">Dimensions</span> (Decimal) to generate product variants.
              </p>
              <Button size="sm" variant="outline" onClick={addAttribute} className="text-xs mt-2">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Your First Attribute
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {attributes.map((attr, idx) => (
                <div key={idx} className="p-4 rounded-xl border bg-card/60 space-y-3 shadow-2xs">
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Attribute Name */}
                    <div className="flex-1 min-w-[160px]">
                      <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                        Attribute Name <span className="text-destructive">*</span>
                      </label>
                      <Input
                        placeholder="e.g. Color, Size, Voltage, Dimensions"
                        value={attr.name}
                        onChange={(e) => updateAttribute(idx, { name: e.target.value })}
                        className="text-xs h-8"
                      />
                    </div>

                    {/* Data Type Selector */}
                    <div className="w-36">
                      <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                        Value Data Type
                      </label>
                      <Select
                        value={attr.type}
                        onChange={(e) => updateAttribute(idx, { type: e.target.value as DynamicType })}
                        className="text-xs h-8"
                      >
                        <option value="STRING">String (Text)</option>
                        <option value="INTEGER">Integer (Whole #)</option>
                        <option value="DECIMAL">Decimal (Float)</option>
                        <option value="FLOAT">Float (Scientific)</option>
                        <option value="BOOLEAN">Boolean (Yes/No)</option>
                      </Select>
                    </div>

                    {/* Measurement Unit */}
                    <div className="w-24">
                      <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                        Unit (Opt)
                      </label>
                      <Input
                        placeholder="e.g. mm, V, kW"
                        value={attr.unit ?? ''}
                        onChange={(e) => updateAttribute(idx, { unit: e.target.value })}
                        className="text-xs h-8"
                      />
                    </div>

                    {/* Delete Attribute Button */}
                    <div className="pt-5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeAttribute(idx)}
                        title="Remove Attribute"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Permitted Values vs Free-Form Builder */}
                  <div className="pt-2 border-t border-border/50">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        Permitted Values
                        <Badge variant="outline" className="text-[10px] font-normal uppercase py-0">
                          {attr.type}
                        </Badge>
                      </span>

                      {/* Type format hint */}
                      <span className="text-[11px] text-muted-foreground">
                        {attr.type === 'INTEGER' && 'Enter whole integers (e.g. 100, 200, 300)'}
                        {attr.type === 'DECIMAL' && 'Enter decimal numbers (e.g. 1.5, 2.5, 4.0)'}
                        {attr.type === 'FLOAT' && 'Enter float numbers (e.g. 0.75, 1.25)'}
                        {attr.type === 'BOOLEAN' && 'True or False'}
                        {attr.type === 'STRING' && 'Enter text options (e.g. Black, Silver, Red)'}
                      </span>
                    </div>

                    {/* Values Pill List */}
                    <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                      {attr.permittedValues.map((val, vIdx) => (
                        <span
                          key={vIdx}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-medium border border-primary/20 shadow-2xs"
                        >
                          {String(val)}
                          {attr.unit && <span className="text-[10px] opacity-70">{attr.unit}</span>}
                          <button
                            type="button"
                            onClick={() => removePermittedValue(idx, vIdx)}
                            className="hover:text-destructive ms-0.5"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}

                      {attr.permittedValues.length === 0 && (
                        <span className="text-xs text-muted-foreground italic">No permitted values added yet.</span>
                      )}
                    </div>

                    {/* Add Value Input & Button */}
                    <div className="flex items-center gap-2 max-w-sm">
                      {attr.type === 'BOOLEAN' ? (
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-xs h-7"
                            onClick={() => {
                              if (!attr.permittedValues.includes(true)) {
                                updateAttribute(idx, { permittedValues: [...attr.permittedValues, true] });
                              }
                            }}
                          >
                            + Add True
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-xs h-7"
                            onClick={() => {
                              if (!attr.permittedValues.includes(false)) {
                                updateAttribute(idx, { permittedValues: [...attr.permittedValues, false] });
                              }
                            }}
                          >
                            + Add False
                          </Button>
                        </div>
                      ) : (
                        <>
                          <Input
                            placeholder={`Add ${attr.type.toLowerCase()} value...`}
                            value={attr.newValueInput ?? ''}
                            onChange={(e) => updateAttribute(idx, { newValueInput: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                addPermittedValue(idx);
                              }
                            }}
                            className="text-xs h-7.5"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => addPermittedValue(idx)}
                            className="text-xs h-7.5 shrink-0"
                          >
                            <Plus className="h-3 w-3 mr-1" /> Add
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Generate Combinations Matrix Button */}
              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  onClick={generateCombinations}
                  className="gap-2 text-xs shadow-xs font-semibold"
                >
                  <Sparkles className="h-4 w-4" />
                  Generate Variant SKU Combinations Matrix
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. GENERATED VARIANTS MATRIX TABLE */}
      {variants.length > 0 && (
        <Card className="overflow-hidden border shadow-xs">
          <CardHeader className="bg-muted/40 border-b py-3 px-4 flex flex-row items-center justify-between">
            <div className="space-y-0.5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                Product Variants Matrix ({variants.filter((v) => v.enabled).length} Enabled)
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Distinct buyable/sellable SKUs generated from attribute combinations. Customize prices and barcodes per variant.
              </p>
            </div>

            {productId && (
              <Button
                size="sm"
                onClick={saveVariantsToServer}
                disabled={saving}
                className="text-xs gap-1.5 font-semibold shadow-xs"
              >
                {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save Variants to Database
              </Button>
            )}
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs bg-muted/20">
                    <TableHead className="w-10 text-center">Active</TableHead>
                    <TableHead className="w-36">Variant SKU</TableHead>
                    <TableHead className="min-w-[200px]">Variant Name</TableHead>
                    <TableHead className="min-w-[150px]">Attributes</TableHead>
                    <TableHead className="w-28 text-end">Sale Price</TableHead>
                    <TableHead className="w-28 text-end">Cost Price</TableHead>
                    <TableHead className="w-32">Barcode</TableHead>
                    {productId && <TableHead className="w-20 text-end">Stock</TableHead>}
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {variants.map((v, vIdx) => (
                    <TableRow key={vIdx} className={cn('text-xs transition-colors', !v.enabled && 'opacity-50 bg-muted/10')}>
                      {/* Checkbox / Enabled */}
                      <TableCell className="text-center">
                        <input
                          type="checkbox"
                          checked={v.enabled}
                          onChange={(e) => updateVariant(vIdx, { enabled: e.target.checked })}
                          className="rounded border-border h-4 w-4 text-primary focus:ring-primary cursor-pointer"
                        />
                      </TableCell>

                      {/* Variant SKU */}
                      <TableCell>
                        <Input
                          value={v.sku}
                          onChange={(e) => updateVariant(vIdx, { sku: e.target.value })}
                          disabled={!v.enabled}
                          className="text-xs font-mono font-semibold h-7.5"
                        />
                      </TableCell>

                      {/* Variant Name */}
                      <TableCell>
                        <Input
                          value={v.name}
                          onChange={(e) => updateVariant(vIdx, { name: e.target.value })}
                          disabled={!v.enabled}
                          className="text-xs h-7.5"
                        />
                      </TableCell>

                      {/* Attributes Badges */}
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(v.variantAttributes).map(([k, val]) => (
                            <Badge key={k} variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                              <span className="text-muted-foreground me-1">{k}:</span>
                              <span className="font-semibold">{String(val)}</span>
                            </Badge>
                          ))}
                        </div>
                      </TableCell>

                      {/* Sale Price */}
                      <TableCell className="text-end">
                        <Input
                          type="number"
                          step="0.01"
                          value={v.salePrice}
                          onChange={(e) => updateVariant(vIdx, { salePrice: Number(e.target.value) || 0 })}
                          disabled={!v.enabled}
                          className="text-xs font-mono text-end font-semibold text-primary h-7.5"
                        />
                      </TableCell>

                      {/* Cost Price */}
                      <TableCell className="text-end">
                        <Input
                          type="number"
                          step="0.01"
                          value={v.costPrice ?? ''}
                          onChange={(e) => updateVariant(vIdx, { costPrice: e.target.value ? Number(e.target.value) : undefined })}
                          disabled={!v.enabled}
                          placeholder="0.00"
                          className="text-xs font-mono text-end h-7.5"
                        />
                      </TableCell>

                      {/* Barcode */}
                      <TableCell>
                        <Input
                          value={v.barcode ?? ''}
                          onChange={(e) => updateVariant(vIdx, { barcode: e.target.value })}
                          disabled={!v.enabled}
                          placeholder="e.g. 690..."
                          className="text-xs font-mono h-7.5"
                        />
                      </TableCell>

                      {/* Stock */}
                      {productId && (
                        <TableCell className="text-end font-mono font-bold">
                          {v.stock ?? 0}
                        </TableCell>
                      )}

                      {/* Delete */}
                      <TableCell className="text-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeVariant(vIdx)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Bottom Save Bar */}
            {productId && (
              <div className="p-3 bg-muted/20 border-t flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {variants.filter((v) => v.enabled).length} of {variants.length} variants selected for creation/update.
                </span>
                <Button
                  size="sm"
                  onClick={saveVariantsToServer}
                  disabled={saving}
                  className="text-xs gap-1.5 font-semibold shadow-xs"
                >
                  {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save Variants to Database
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
