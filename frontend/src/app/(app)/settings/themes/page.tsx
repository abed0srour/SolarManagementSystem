'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import {
  Check,
  Download,
  FileText,
  Laptop,
  Moon,
  Palette as PageIcon,
  Save,
  Sliders,
  Sun,
  Eye,
  Image as ImageIcon,
  Type,
  PenTool,
  RotateCcw,
} from 'lucide-react';
import PageHeader from '../../../../components/page-header';
import { ACCENTS, AccentId } from '../../../../lib/accents';
import { useAccent } from '../../../../components/accent-provider';
import { cn } from '../../../../lib/utils';
import { api, errMsg } from '../../../../lib/api';
import { toast } from 'sonner';

/** The tick badge on a selected card. */
function SelectedBadge() {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
      <Check className="h-3 w-3" strokeWidth={3} />
    </span>
  );
}

/** Miniature of a page in the given mode. */
function ModePreview({ mode }: { mode: 'light' | 'dark' | 'system' }) {
  const pane = (dark: boolean, className?: string) => (
    <div className={cn('flex flex-col gap-2 p-3', dark ? 'bg-[#161615]' : 'bg-[#f4f3f0]', className)}>
      <div className={cn('h-2 w-3/4 rounded-full', dark ? 'bg-white/25' : 'bg-black/15')} />
      <div className={cn('h-2 w-1/2 rounded-full', dark ? 'bg-white/15' : 'bg-black/10')} />
      <div className={cn('mt-1 h-8 rounded-md', dark ? 'bg-white/10' : 'bg-white')} />
    </div>
  );

  if (mode === 'system') {
    return (
      <div className="grid h-24 grid-cols-2 overflow-hidden rounded-lg border">
        {pane(false)}
        {pane(true)}
      </div>
    );
  }
  return <div className="h-24 overflow-hidden rounded-lg border">{pane(mode === 'dark', 'h-full')}</div>;
}

/** A selectable card. */
function OptionCard({
  selected,
  onSelect,
  children,
  className,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'rounded-xl border bg-card p-3 text-start transition-all hover:shadow-sm',
        selected ? 'border-primary ring-2 ring-primary/20 shadow-sm' : 'hover:border-foreground/20',
        className,
      )}
    >
      {children}
    </button>
  );
}

interface PdfThemeConfig {
  presetId: string;
  primaryColor: string;
  secondaryColor: string;
  darkColor: string;
  grayColor: string;
  lightColor: string;
  bandColor: string;
  headerLayout: 'MODERN_SPLIT' | 'CENTERED_BANNER' | 'CLEAN_MINIMAL';
  tableStyle: 'MINIMAL_DIVIDERS' | 'STRIPED' | 'BORDERED';
  fontFamily: 'Helvetica' | 'TimesRoman' | 'Courier';
  fontWeight: 'REGULAR' | 'BOLD' | 'EXTRA_BOLD';
  logoSize: 'SMALL' | 'MEDIUM' | 'LARGE' | 'XLARGE';
  logoScale: number;
  footerNote: string;
  showLogo: boolean;
  showSignature: boolean;
  signatureTitle: string;
  signatureSignerName: string;
  signatureFont: 'DancingScript' | 'GreatVibes' | 'Caveat' | 'Times';
  watermarkText: string;
  showWatermark: boolean;
}

const PDF_PRESETS: Record<
  string,
  {
    name: string;
    description: string;
    swatch: string[];
    primaryColor: string;
    secondaryColor: string;
    darkColor: string;
    grayColor: string;
    lightColor: string;
    bandColor: string;
    headerLayout: 'MODERN_SPLIT' | 'CENTERED_BANNER' | 'CLEAN_MINIMAL';
    tableStyle: 'MINIMAL_DIVIDERS' | 'STRIPED' | 'BORDERED';
    fontFamily: 'Helvetica' | 'TimesRoman' | 'Courier';
    fontWeight: 'REGULAR' | 'BOLD' | 'EXTRA_BOLD';
    logoSize: 'SMALL' | 'MEDIUM' | 'LARGE' | 'XLARGE';
    logoScale: number;
    showLogo: boolean;
    showSignature: boolean;
  }
> = {
  classic_default: {
    name: 'Classic Default',
    description: 'The clean original layout with header logo and subtle gray metadata band',
    swatch: ['#161615', '#71717A', '#F4F4F5'],
    primaryColor: '#161615',
    secondaryColor: '#71717A',
    darkColor: '#161615',
    grayColor: '#71717A',
    lightColor: '#E4E4E7',
    bandColor: '#F4F4F5',
    headerLayout: 'MODERN_SPLIT',
    tableStyle: 'MINIMAL_DIVIDERS',
    fontFamily: 'Helvetica',
    fontWeight: 'BOLD',
    logoSize: 'MEDIUM',
    logoScale: 100,
    showLogo: true,
    showSignature: false,
  },
  executive_slate: {
    name: 'Executive Slate',
    description: 'High-end Scandinavian dark slate. Crisp, bold and modern',
    swatch: ['#1E293B', '#475569', '#F1F5F9'],
    primaryColor: '#1E293B',
    secondaryColor: '#475569',
    darkColor: '#0F172A',
    grayColor: '#64748B',
    lightColor: '#E2E8F0',
    bandColor: '#F1F5F9',
    headerLayout: 'MODERN_SPLIT',
    tableStyle: 'MINIMAL_DIVIDERS',
    fontFamily: 'Helvetica',
    fontWeight: 'EXTRA_BOLD',
    logoSize: 'MEDIUM',
    logoScale: 100,
    showLogo: true,
    showSignature: true,
  },
  corporate_navy: {
    name: 'Corporate Navy',
    description: 'Corporate B2B, Finance, Logistics & Legal',
    swatch: ['#1E3A8A', '#475569', '#F8FAFC'],
    primaryColor: '#1E3A8A',
    secondaryColor: '#475569',
    darkColor: '#0F172A',
    grayColor: '#64748B',
    lightColor: '#CBD5E1',
    bandColor: '#F8FAFC',
    headerLayout: 'MODERN_SPLIT',
    tableStyle: 'MINIMAL_DIVIDERS',
    fontFamily: 'Helvetica',
    fontWeight: 'BOLD',
    logoSize: 'MEDIUM',
    logoScale: 100,
    showLogo: true,
    showSignature: true,
  },
  modern_minimal: {
    name: 'Modern Minimalist',
    description: 'Tech Studios, SaaS, Design & Modern Consultancies',
    swatch: ['#0F172A', '#334155', '#F8FAFC'],
    primaryColor: '#0F172A',
    secondaryColor: '#334155',
    darkColor: '#020617',
    grayColor: '#64748B',
    lightColor: '#E2E8F0',
    bandColor: '#F8FAFC',
    headerLayout: 'CLEAN_MINIMAL',
    tableStyle: 'MINIMAL_DIVIDERS',
    fontFamily: 'Helvetica',
    fontWeight: 'REGULAR',
    logoSize: 'SMALL',
    logoScale: 60,
    showLogo: false,
    showSignature: false,
  },
  emerald_growth: {
    name: 'Emerald Growth',
    description: 'Renewable Energy, Agriculture, Eco & Healthcare',
    swatch: ['#047857', '#059669', '#F0FDF4'],
    primaryColor: '#047857',
    secondaryColor: '#059669',
    darkColor: '#064E3B',
    grayColor: '#475569',
    lightColor: '#A7F3D0',
    bandColor: '#F0FDF4',
    headerLayout: 'MODERN_SPLIT',
    tableStyle: 'STRIPED',
    fontFamily: 'Helvetica',
    fontWeight: 'BOLD',
    logoSize: 'LARGE',
    logoScale: 135,
    showLogo: true,
    showSignature: false,
  },
  solar_amber: {
    name: 'Solar Amber',
    description: 'Solar Energy, Engineering, Hardware & Contracting',
    swatch: ['#D97706', '#B45309', '#FFFBEB'],
    primaryColor: '#D97706',
    secondaryColor: '#B45309',
    darkColor: '#1C1917',
    grayColor: '#78716C',
    lightColor: '#FDE68A',
    bandColor: '#FFFBEB',
    headerLayout: 'MODERN_SPLIT',
    tableStyle: 'MINIMAL_DIVIDERS',
    fontFamily: 'Helvetica',
    fontWeight: 'EXTRA_BOLD',
    logoSize: 'LARGE',
    logoScale: 135,
    showLogo: true,
    showSignature: true,
  },
  retail_ruby: {
    name: 'Retail Ruby',
    description: 'Retail POS, Automotive, Consumer Goods & Commerce',
    swatch: ['#BE123C', '#E11D48', '#FFF1F2'],
    primaryColor: '#BE123C',
    secondaryColor: '#E11D48',
    darkColor: '#18181B',
    grayColor: '#71717A',
    lightColor: '#FECDD3',
    bandColor: '#FFF1F2',
    headerLayout: 'CENTERED_BANNER',
    tableStyle: 'BORDERED',
    fontFamily: 'Helvetica',
    fontWeight: 'BOLD',
    logoSize: 'MEDIUM',
    logoScale: 100,
    showLogo: true,
    showSignature: false,
  },
  royal_indigo: {
    name: 'Royal Indigo',
    description: 'Creative Agencies, High-Tech & Digital Services',
    swatch: ['#4338CA', '#6366F1', '#EEF2FF'],
    primaryColor: '#4338CA',
    secondaryColor: '#6366F1',
    darkColor: '#1E1B4B',
    grayColor: '#64748B',
    lightColor: '#C7D2FE',
    bandColor: '#EEF2FF',
    headerLayout: 'MODERN_SPLIT',
    tableStyle: 'STRIPED',
    fontFamily: 'Helvetica',
    fontWeight: 'BOLD',
    logoSize: 'MEDIUM',
    logoScale: 100,
    showLogo: true,
    showSignature: true,
  },
  luxury_gold: {
    name: 'Luxury Gold',
    description: 'Warm amber & deep onyx. Premium aesthetics for high-ticket brands',
    swatch: ['#B45309', '#9A3412', '#FEF3C7'],
    primaryColor: '#B45309',
    secondaryColor: '#9A3412',
    darkColor: '#1C1917',
    grayColor: '#78716C',
    lightColor: '#FDE68A',
    bandColor: '#FEF3C7',
    headerLayout: 'CENTERED_BANNER',
    tableStyle: 'BORDERED',
    fontFamily: 'TimesRoman',
    fontWeight: 'BOLD',
    logoSize: 'LARGE',
    logoScale: 140,
    showLogo: true,
    showSignature: true,
  },
  classic_monochrome: {
    name: 'Classic Monochrome',
    description: 'Formal Documentation & Fast High-Contrast Printing',
    swatch: ['#111827', '#374151', '#F3F4F6'],
    primaryColor: '#111827',
    secondaryColor: '#374151',
    darkColor: '#000000',
    grayColor: '#4B5563',
    lightColor: '#D1D5DB',
    bandColor: '#F3F4F6',
    headerLayout: 'CLEAN_MINIMAL',
    tableStyle: 'BORDERED',
    fontFamily: 'TimesRoman',
    fontWeight: 'REGULAR',
    logoSize: 'SMALL',
    logoScale: 60,
    showLogo: false,
    showSignature: true,
  },
};

const DEFAULT_PDF_CONFIG: PdfThemeConfig = {
  presetId: 'classic_default',
  primaryColor: '#161615',
  secondaryColor: '#71717A',
  darkColor: '#161615',
  grayColor: '#71717A',
  lightColor: '#E4E4E7',
  bandColor: '#F4F4F5',
  headerLayout: 'MODERN_SPLIT',
  tableStyle: 'MINIMAL_DIVIDERS',
  fontFamily: 'Helvetica',
  fontWeight: 'BOLD',
  logoSize: 'MEDIUM',
  logoScale: 100,
  footerNote: 'Thank you for choosing Srour Solar Power. We appreciate your business and look forward to serving you again.',
  showLogo: true,
  showSignature: false,
  signatureTitle: 'Authorized Signature & Stamp',
  signatureSignerName: '',
  signatureFont: 'DancingScript',
  watermarkText: '',
  showWatermark: false,
};

export default function ThemesPage() {
  const t = useTranslations();
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();

  const [mounted, setMounted] = useState(false);
  const [pdfConfig, setPdfConfig] = useState<PdfThemeConfig>(DEFAULT_PDF_CONFIG);
  const [company, setCompany] = useState<{ name: string; address?: string; phone?: string; email?: string; logoUrl?: string }>({
    name: 'Srour Solar Power',
    address: 'Albazourieh',
    phone: '+961 76 675 348',
    email: 'sroursolarpower@gmail.com',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Fetch tenant's saved PDF theme and company branding
    api
      .get('/settings')
      .then((res) => {
        const settings = res.data || {};
        if (settings.pdf_theme) {
          setPdfConfig((prev) => ({
            ...prev,
            ...settings.pdf_theme,
            logoScale: settings.pdf_theme.logoScale ?? (settings.pdf_theme.logoSize === 'SMALL' ? 60 : settings.pdf_theme.logoSize === 'LARGE' ? 135 : settings.pdf_theme.logoSize === 'XLARGE' ? 170 : 100),
            signatureFont: settings.pdf_theme.signatureFont || 'DancingScript',
          }));
        }
        if (settings.company) {
          setCompany((prev) => ({ ...prev, ...settings.company }));
        }
      })
      .catch(() => {});
  }, []);

  const selectPreset = (key: string) => {
    const preset = PDF_PRESETS[key];
    if (!preset) return;
    setPdfConfig((prev) => ({
      ...prev,
      presetId: key,
      primaryColor: preset.primaryColor,
      secondaryColor: preset.secondaryColor,
      darkColor: preset.darkColor,
      grayColor: preset.grayColor,
      lightColor: preset.lightColor,
      bandColor: preset.bandColor,
      headerLayout: preset.headerLayout,
      tableStyle: preset.tableStyle,
      fontFamily: preset.fontFamily,
      fontWeight: preset.fontWeight,
      logoSize: preset.logoSize,
      logoScale: preset.logoScale,
      showLogo: preset.showLogo,
      showSignature: preset.showSignature,
    }));
  };

  const handleResetToDefault = () => {
    setPdfConfig({
      ...DEFAULT_PDF_CONFIG,
      footerNote: `Thank you for choosing ${company.name || 'Srour Solar Power'}. We appreciate your business and look forward to serving you again.`,
    });
    toast.success(t('themes.resetDefaultSuccess') || 'Reset to original Classic Default theme');
  };

  const handleSavePdfTheme = async () => {
    setIsSaving(true);
    try {
      await api.put('/settings/pdf_theme', pdfConfig);
      toast.success(t('themes.pdfThemeSaved') || 'PDF Theme successfully saved for your store!');
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadSamplePdf = async () => {
    setIsDownloading(true);
    try {
      const res = await api.post('/invoices/pdf/preview-sample', pdfConfig, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `sample-${pdfConfig.presetId || 'invoice'}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
      toast.success(t('common.downloadPdf') || 'Sample PDF downloaded');
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setIsDownloading(false);
    }
  };

  const MODES = [
    { id: 'light', icon: Sun },
    { id: 'dark', icon: Moon },
    { id: 'system', icon: Laptop },
  ] as const;

  // Dynamic logo dimensions for live A4 sheet based on continuous scale slider
  const currentScale = Math.max(30, Math.min(250, pdfConfig.logoScale ?? 100));
  const logoHeightPx = Math.round(52 * (currentScale / 100));
  const logoMaxHeightPx = Math.round(115 * (currentScale / 100));
  const logoMaxWidthPx = Math.round(230 * (currentScale / 100));

  // Signature font styles
  const getSignatureFontFamily = () => {
    switch (pdfConfig.signatureFont) {
      case 'GreatVibes':
        return '"Great Vibes", cursive';
      case 'Caveat':
        return '"Caveat", cursive';
      case 'Times':
        return '"Times New Roman", Times, serif';
      case 'DancingScript':
      default:
        return '"Dancing Script", cursive';
    }
  };

  return (
    <div className="space-y-10 pb-16 max-w-full">
      <PageHeader icon={PageIcon} title={t('themes.title')} subtitle={t('themes.subtitle')} />

      {/* SECTION 1: SYSTEM & APP THEME */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        {/* App Mode */}
        <section className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6 shadow-sm">
          <div>
            <h2 className="text-base font-semibold">{t('themes.mode')}</h2>
            <p className="text-xs sm:text-sm text-muted-foreground">{t('themes.modeHint')}</p>
          </div>
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
            {MODES.map(({ id, icon: Icon }) => (
              <OptionCard key={id} selected={mounted && theme === id} onSelect={() => setTheme(id)}>
                <ModePreview mode={id} />
                <div className="mt-2.5 flex items-center justify-between px-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-xs sm:text-sm font-medium truncate">{t(`themes.${id}`)}</span>
                  </div>
                  {mounted && theme === id && <SelectedBadge />}
                </div>
              </OptionCard>
            ))}
          </div>
        </section>

        {/* App Accent Color (6 Themes in clean 2-column layout) */}
        <section className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6 shadow-sm">
          <div>
            <h2 className="text-base font-semibold">{t('themes.colorTheme')}</h2>
            <p className="text-xs sm:text-sm text-muted-foreground">{t('themes.colorThemeHint')}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ACCENTS.map(({ id, swatch }) => (
              <OptionCard key={id} selected={accent === id} onSelect={() => setAccent(id as AccentId)} className="p-2.5 sm:p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="relative flex h-6 w-9 shrink-0 items-center">
                      <span className="absolute start-0 h-6 w-6 rounded-full shadow-sm" style={{ background: swatch[0] }} />
                      <span
                        className="absolute start-3.5 h-6 w-6 rounded-full border-2 border-card shadow-sm"
                        style={{ background: swatch[1] }}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs sm:text-sm font-semibold truncate">{t(`themes.accent_${id}`)}</div>
                      <p className="text-[11px] text-muted-foreground truncate">{t(`themes.accent_${id}Hint`)}</p>
                    </div>
                  </div>
                  {accent === id && <SelectedBadge />}
                </div>
              </OptionCard>
            ))}
          </div>
        </section>
      </div>

      {/* SECTION 2: UNIVERSAL DOCUMENT & PDF THEME STUDIO */}
      <section className="space-y-6 sm:space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="h-5 w-5" />
              </span>
              <h2 className="text-lg sm:text-xl font-bold tracking-tight">
                {t('themes.pdfStudioTitle') || 'Document & PDF Theme Studio'}
              </h2>
            </div>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
              {t('themes.pdfStudioSubtitle') ||
                'Customize branding colors, typography, header logo, layout, and signatures across all generated documents'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* RESET TO DEFAULT BUTTON */}
            <button
              type="button"
              onClick={handleResetToDefault}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3.5 py-2 text-xs sm:text-sm font-medium transition-colors hover:bg-muted"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('themes.resetToDefault') || 'Use Classic Default'}
            </button>

            <button
              type="button"
              onClick={handleDownloadSamplePdf}
              disabled={isDownloading}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3.5 py-2 text-xs sm:text-sm font-medium transition-colors hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5" />
              {isDownloading ? 'Generating…' : t('themes.downloadSample') || 'Download Sample PDF'}
            </button>

            <button
              type="button"
              onClick={handleSavePdfTheme}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 sm:px-5 py-2 text-xs sm:text-sm font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {isSaving ? 'Saving…' : t('themes.savePdfTheme') || 'Save PDF Theme'}
            </button>
          </div>
        </div>

        {/* 2.1 Presets Selector (10 Presets in fully responsive grid) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">{t('themes.pdfPresets') || 'Industry Theme Presets'}</h3>
              <p className="text-xs text-muted-foreground">
                {t('themes.pdfPresetsHint') || 'Select a curated aesthetic or customize your own brand identity'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-3">
            {Object.entries(PDF_PRESETS).map(([key, item]) => {
              const isSelected = pdfConfig.presetId === key;
              return (
                <OptionCard key={key} selected={isSelected} onSelect={() => selectPreset(key)} className="p-3">
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex -space-x-1.5 overflow-hidden">
                      <span
                        className="inline-block h-4 w-4 sm:h-5 sm:w-5 rounded-full ring-2 ring-background shadow-xs"
                        style={{ backgroundColor: item.primaryColor }}
                      />
                      <span
                        className="inline-block h-4 w-4 sm:h-5 sm:w-5 rounded-full ring-2 ring-background shadow-xs"
                        style={{ backgroundColor: item.secondaryColor }}
                      />
                      <span
                        className="inline-block h-4 w-4 sm:h-5 sm:w-5 rounded-full ring-2 ring-background border shadow-xs"
                        style={{ backgroundColor: item.bandColor }}
                      />
                    </div>
                    {isSelected && <SelectedBadge />}
                  </div>

                  <div className="mt-2">
                    <div className="flex items-center gap-1">
                      <h4 className="text-xs font-bold truncate">{t(`themes.preset_${key}`) || item.name}</h4>
                      {key === 'classic_default' && (
                        <span className="rounded bg-primary/10 px-1 py-0.2 text-[8px] font-semibold text-primary shrink-0">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] sm:text-[11px] text-muted-foreground line-clamp-2">
                      {t(`themes.preset_${key}Desc`) || item.description}
                    </p>
                  </div>
                </OptionCard>
              );
            })}
          </div>
        </div>

        {/* 2.2 Studio Workstation: Dual-Column Customizer & Live A4 Mockup */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* LEFT: Customizer Controls (5 Cols) */}
          <div className="xl:col-span-5 space-y-5 sm:space-y-6 rounded-2xl border bg-card p-4 sm:p-6 shadow-sm">
            <div className="flex items-center gap-2 border-b pb-3">
              <Sliders className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">{t('themes.customStyling') || 'Document Customization'}</h3>
            </div>

            {/* Logo Settings: Show/Hide & Continuous Slider up to 200% */}
            <div className="space-y-3 rounded-xl border bg-muted/30 p-3.5 sm:p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 sm:gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background border shadow-xs text-muted-foreground">
                    <ImageIcon className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-xs font-semibold">{t('themes.showLogo') || 'Show Company Logo'}</div>
                    <p className="text-[11px] text-muted-foreground">
                      {t('themes.showLogoHint') || 'Display company logo in header'}
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex cursor-pointer items-center shrink-0">
                  <input
                    type="checkbox"
                    checked={pdfConfig.showLogo}
                    onChange={(e) => setPdfConfig({ ...pdfConfig, showLogo: e.target.checked, presetId: 'custom' })}
                    className="peer sr-only"
                  />
                  <div className="h-5 w-9 rounded-full bg-muted-foreground/30 transition-colors peer-checked:bg-primary peer-focus:outline-none after:absolute after:start-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full" />
                </label>
              </div>

              {pdfConfig.showLogo && (
                <div className="border-t pt-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-muted-foreground">
                      {t('themes.logoSize') || 'Logo Scaling'}
                    </label>
                    <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-bold text-primary">
                      {pdfConfig.logoScale ?? 100}%
                    </span>
                  </div>

                  {/* Range Slider 30% to 250% */}
                  <div className="space-y-1">
                    <input
                      type="range"
                      min="30"
                      max="250"
                      step="5"
                      value={pdfConfig.logoScale ?? 100}
                      onChange={(e) =>
                        setPdfConfig({
                          ...pdfConfig,
                          logoScale: Number(e.target.value),
                          presetId: 'custom',
                        })
                      }
                      className="h-2 w-full cursor-pointer accent-primary rounded-lg bg-neutral-200 dark:bg-neutral-800"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                      <span>30%</span>
                      <span>100%</span>
                      <span>250%</span>
                    </div>
                  </div>

                  {/* Quick Preset Pills */}
                  <div className="grid grid-cols-6 gap-1 pt-1">
                    {[50, 75, 100, 150, 200, 250].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() =>
                          setPdfConfig({
                            ...pdfConfig,
                            logoScale: val,
                            presetId: 'custom',
                          })
                        }
                        className={cn(
                          'rounded border py-1 text-center text-[10px] font-mono transition-all',
                          (pdfConfig.logoScale ?? 100) === val
                            ? 'border-primary bg-primary text-primary-foreground font-bold'
                            : 'hover:bg-muted text-muted-foreground',
                        )}
                      >
                        {val}%
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Typography & Font Weight */}
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center gap-2">
                <Type className="h-4 w-4 text-muted-foreground" />
                <label className="block text-xs font-semibold uppercase text-muted-foreground">
                  {t('themes.fontFamily') || 'Document Typography'}
                </label>
              </div>

              {/* Font Family Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { id: 'Helvetica', label: 'Sans (Helvetica)', sub: 'Modern & Clean' },
                  { id: 'TimesRoman', label: 'Serif (Times)', sub: 'Classic Editorial' },
                  { id: 'Courier', label: 'Mono (Courier)', sub: 'Tech Monospace' },
                ].map((font) => (
                  <button
                    key={font.id}
                    type="button"
                    onClick={() =>
                      setPdfConfig({
                        ...pdfConfig,
                        fontFamily: font.id as PdfThemeConfig['fontFamily'],
                        presetId: 'custom',
                      })
                    }
                    className={cn(
                      'rounded-lg border p-2.5 text-start transition-all',
                      pdfConfig.fontFamily === font.id
                        ? 'border-primary bg-primary/10 ring-1 ring-primary'
                        : 'hover:bg-muted',
                    )}
                  >
                    <div
                      className="text-xs font-bold"
                      style={{
                        fontFamily:
                          font.id === 'TimesRoman'
                            ? 'Times New Roman, serif'
                            : font.id === 'Courier'
                              ? 'Courier New, monospace'
                              : 'Inter, sans-serif',
                      }}
                    >
                      {font.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{font.sub}</div>
                  </button>
                ))}
              </div>

              {/* Font Weight Intensity */}
              <div className="pt-2">
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">
                  {t('themes.fontWeight') || 'Header Font Weight'}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'REGULAR', label: 'Regular' },
                    { id: 'BOLD', label: 'Bold' },
                    { id: 'EXTRA_BOLD', label: 'Extra Bold' },
                  ].map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() =>
                        setPdfConfig({
                          ...pdfConfig,
                          fontWeight: w.id as PdfThemeConfig['fontWeight'],
                          presetId: 'custom',
                        })
                      }
                      className={cn(
                        'rounded-md border py-1.5 text-center text-xs font-medium transition-all',
                        pdfConfig.fontWeight === w.id
                          ? 'border-primary bg-primary/10 font-bold text-primary'
                          : 'hover:bg-muted',
                      )}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Colors */}
            <div className="space-y-4 border-t pt-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-muted-foreground">
                  {t('themes.primaryColor') || 'Primary Brand Color'}
                </label>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="color"
                    value={pdfConfig.primaryColor}
                    onChange={(e) => setPdfConfig({ ...pdfConfig, primaryColor: e.target.value, presetId: 'custom' })}
                    className="h-10 w-14 cursor-pointer rounded-lg border bg-transparent p-1"
                  />
                  <input
                    type="text"
                    value={pdfConfig.primaryColor}
                    onChange={(e) => setPdfConfig({ ...pdfConfig, primaryColor: e.target.value, presetId: 'custom' })}
                    className="h-10 flex-1 rounded-lg border bg-background px-3 font-mono text-sm uppercase"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-muted-foreground">
                  {t('themes.secondaryColor') || 'Secondary Accent Color'}
                </label>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="color"
                    value={pdfConfig.secondaryColor}
                    onChange={(e) => setPdfConfig({ ...pdfConfig, secondaryColor: e.target.value, presetId: 'custom' })}
                    className="h-10 w-14 cursor-pointer rounded-lg border bg-transparent p-1"
                  />
                  <input
                    type="text"
                    value={pdfConfig.secondaryColor}
                    onChange={(e) => setPdfConfig({ ...pdfConfig, secondaryColor: e.target.value, presetId: 'custom' })}
                    className="h-10 flex-1 rounded-lg border bg-background px-3 font-mono text-sm uppercase"
                  />
                </div>
              </div>
            </div>

            {/* Header Layout */}
            <div className="space-y-2 border-t pt-4">
              <label className="block text-xs font-semibold uppercase text-muted-foreground">
                {t('themes.headerLayout') || 'Header Layout'}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { id: 'MODERN_SPLIT', label: 'Modern Split' },
                  { id: 'CENTERED_BANNER', label: 'Centered Banner' },
                  { id: 'CLEAN_MINIMAL', label: 'Clean Minimal' },
                ].map((layout) => (
                  <button
                    key={layout.id}
                    type="button"
                    onClick={() =>
                      setPdfConfig({
                        ...pdfConfig,
                        headerLayout: layout.id as PdfThemeConfig['headerLayout'],
                        presetId: 'custom',
                      })
                    }
                    className={cn(
                      'rounded-lg border p-2.5 text-center text-xs font-medium transition-colors',
                      pdfConfig.headerLayout === layout.id
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'hover:bg-muted',
                    )}
                  >
                    {layout.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Table Style */}
            <div className="space-y-2 border-t pt-4">
              <label className="block text-xs font-semibold uppercase text-muted-foreground">
                {t('themes.tableStyle') || 'Table & Line Items Style'}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { id: 'MINIMAL_DIVIDERS', label: 'Clean Dividers' },
                  { id: 'STRIPED', label: 'Zebra Striped' },
                  { id: 'BORDERED', label: 'Bordered Grid' },
                ].map((tbl) => (
                  <button
                    key={tbl.id}
                    type="button"
                    onClick={() =>
                      setPdfConfig({
                        ...pdfConfig,
                        tableStyle: tbl.id as PdfThemeConfig['tableStyle'],
                        presetId: 'custom',
                      })
                    }
                    className={cn(
                      'rounded-lg border p-2.5 text-center text-xs font-medium transition-colors',
                      pdfConfig.tableStyle === tbl.id
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'hover:bg-muted',
                    )}
                  >
                    {tbl.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Authorized Signature Block (With Signature Font Selector) */}
            <div className="space-y-3 rounded-xl border bg-muted/30 p-3.5 sm:p-4 border-t">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 sm:gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background border shadow-xs text-muted-foreground">
                    <PenTool className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-xs font-semibold">{t('themes.showSignature') || 'Authorized Signature & Stamp Block'}</div>
                    <p className="text-[11px] text-muted-foreground">
                      {t('themes.showSignatureHint') || 'Add signature line and sign-off at bottom'}
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex cursor-pointer items-center shrink-0">
                  <input
                    type="checkbox"
                    checked={pdfConfig.showSignature}
                    onChange={(e) => setPdfConfig({ ...pdfConfig, showSignature: e.target.checked, presetId: 'custom' })}
                    className="peer sr-only"
                  />
                  <div className="h-5 w-9 rounded-full bg-muted-foreground/30 transition-colors peer-checked:bg-primary peer-focus:outline-none after:absolute after:start-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full" />
                </label>
              </div>

              {pdfConfig.showSignature && (
                <div className="border-t pt-3 space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground">
                      {t('themes.signatureSignerName') || 'Signer Name / Written Signature'}
                    </label>
                    <input
                      type="text"
                      value={pdfConfig.signatureSignerName}
                      onChange={(e) => setPdfConfig({ ...pdfConfig, signatureSignerName: e.target.value })}
                      placeholder={t('themes.signatureSignerNamePlaceholder') || 'e.g. Abed Srour'}
                      className="mt-1 w-full rounded-lg border bg-background px-3 py-1.5 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground">
                      {t('themes.signatureTitle') || 'Signature Designation / Official Title'}
                    </label>
                    <input
                      type="text"
                      value={pdfConfig.signatureTitle}
                      onChange={(e) => setPdfConfig({ ...pdfConfig, signatureTitle: e.target.value })}
                      placeholder={t('themes.signatureTitlePlaceholder') || 'Authorized Signature & Stamp'}
                      className="mt-1 w-full rounded-lg border bg-background px-3 py-1.5 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {/* Signature Font Selection */}
                  <div className="space-y-1.5 pt-1">
                    <label className="block text-[11px] font-semibold text-muted-foreground">
                      {t('themes.signatureFont') || 'Signature Handwriting Style'}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'DancingScript', label: 'Dancing Script', style: { fontFamily: '"Dancing Script", cursive' } },
                        { id: 'GreatVibes', label: 'Great Vibes', style: { fontFamily: '"Great Vibes", cursive' } },
                        { id: 'Caveat', label: 'Caveat', style: { fontFamily: '"Caveat", cursive' } },
                        { id: 'Times', label: 'Times Serif', style: { fontFamily: '"Times New Roman", Times, serif' } },
                      ].map((sigF) => (
                        <button
                          key={sigF.id}
                          type="button"
                          onClick={() =>
                            setPdfConfig({
                              ...pdfConfig,
                              signatureFont: sigF.id as PdfThemeConfig['signatureFont'],
                              presetId: 'custom',
                            })
                          }
                          className={cn(
                            'rounded-lg border p-2 text-center transition-all',
                            pdfConfig.signatureFont === sigF.id
                              ? 'border-primary bg-primary/10 ring-1 ring-primary'
                              : 'hover:bg-muted',
                          )}
                        >
                          <div className="text-sm font-semibold" style={sigF.style}>
                            {pdfConfig.signatureSignerName || 'Abed Srour'}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{sigF.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Note & Payment Details */}
            <div className="space-y-2 border-t pt-4">
              <label className="block text-xs font-semibold uppercase text-muted-foreground">
                {t('themes.footerNote') || 'Custom Footer Terms & Bank Details'}
              </label>
              <textarea
                rows={3}
                value={pdfConfig.footerNote}
                onChange={(e) => setPdfConfig({ ...pdfConfig, footerNote: e.target.value })}
                placeholder={t('themes.footerNotePlaceholder') || 'Bank Transfer: IBAN US00-BANK-9920-1123-4455'}
                className="w-full rounded-lg border bg-background p-3 text-xs focus:ring-1 focus:ring-primary focus:outline-none"
              />
            </div>

            {/* Watermark (Optional) */}
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase text-muted-foreground">
                  {t('themes.watermark') || 'Watermark Text'}
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pdfConfig.showWatermark}
                    onChange={(e) => setPdfConfig({ ...pdfConfig, showWatermark: e.target.checked })}
                    className="rounded text-primary"
                  />
                  <span>Show Watermark</span>
                </label>
              </div>
              {pdfConfig.showWatermark && (
                <input
                  type="text"
                  value={pdfConfig.watermarkText}
                  onChange={(e) => setPdfConfig({ ...pdfConfig, watermarkText: e.target.value })}
                  placeholder="e.g. ORIGINAL / CONFIDENTIAL"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-xs uppercase focus:ring-1 focus:ring-primary"
                />
              )}
            </div>
          </div>

          {/* RIGHT: Live Interactive Document Mockup (7 Cols - Sticky workstation preview) */}
          <div className="xl:col-span-7 space-y-3 w-full xl:sticky xl:top-20 self-start">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">{t('themes.previewTitle') || 'Live Document Preview'}</span>
              </div>
              <span className="text-xs text-muted-foreground">Standard A4 Sheet Format</span>
            </div>

            {/* Rendered A4 Sheet Container with smooth horizontal scroll on mobile */}
            <div className="overflow-x-auto w-full rounded-2xl border bg-neutral-100 dark:bg-neutral-900/50 p-2 sm:p-6 pb-6 shadow-inner flex justify-start sm:justify-center">
              <div
                className="relative min-w-[500px] sm:min-w-0 w-full max-w-[540px] bg-white text-neutral-900 shadow-2xl rounded-sm p-6 sm:p-8 space-y-6 transition-all shrink-0"
                style={{
                  fontFamily:
                    pdfConfig.fontFamily === 'TimesRoman'
                      ? 'Times New Roman, serif'
                      : pdfConfig.fontFamily === 'Courier'
                        ? 'Courier New, monospace'
                        : 'Helvetica, Arial, sans-serif',
                }}
              >
                {/* Watermark Overlay */}
                {pdfConfig.showWatermark && pdfConfig.watermarkText && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
                    <span className="text-5xl font-black uppercase text-neutral-900/[0.04] rotate-45 select-none tracking-widest">
                      {pdfConfig.watermarkText}
                    </span>
                  </div>
                )}

                {/* HEADER LAYOUT: CLEAN_MINIMAL */}
                {pdfConfig.headerLayout === 'CLEAN_MINIMAL' && (
                  <div>
                    <div className="h-2 w-full rounded-t-sm" style={{ backgroundColor: pdfConfig.primaryColor }} />
                    <div className="mt-4 flex items-start justify-between border-b pb-4">
                      <div>
                        {pdfConfig.showLogo && company.logoUrl ? (
                          <div className="mb-2">
                            <img
                              src={company.logoUrl}
                              alt={company.name}
                              className="w-auto object-contain transition-all"
                              style={{
                                height: `${logoHeightPx}px`,
                                maxHeight: `${logoMaxHeightPx}px`,
                                maxWidth: `${logoMaxWidthPx}px`,
                              }}
                            />
                          </div>
                        ) : null}
                        <h1
                          className={cn(
                            'text-lg tracking-tight',
                            pdfConfig.fontWeight === 'EXTRA_BOLD' ? 'font-black' : pdfConfig.fontWeight === 'REGULAR' ? 'font-normal' : 'font-bold',
                          )}
                          style={{ color: pdfConfig.primaryColor }}
                        >
                          {company.name}
                        </h1>
                        <p className="mt-0.5 text-xs text-neutral-500">{[company.address, company.phone].filter(Boolean).join(' · ')}</p>
                      </div>
                      <div className="text-right">
                        <div
                          className={cn(
                            'text-lg uppercase tracking-wider',
                            pdfConfig.fontWeight === 'EXTRA_BOLD' ? 'font-black' : 'font-bold',
                          )}
                          style={{ color: pdfConfig.darkColor }}
                        >
                          TAX INVOICE
                        </div>
                        <div className="text-xs text-neutral-500 font-mono">#00014</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* HEADER LAYOUT: CENTERED_BANNER */}
                {pdfConfig.headerLayout === 'CENTERED_BANNER' && (
                  <div className="text-center space-y-2 border-b pb-4">
                    {pdfConfig.showLogo && company.logoUrl && (
                      <div className="flex justify-center mb-1">
                        <img
                          src={company.logoUrl}
                          alt={company.name}
                          className="w-auto object-contain transition-all"
                          style={{
                            height: `${logoHeightPx}px`,
                            maxHeight: `${logoMaxHeightPx}px`,
                            maxWidth: `${logoMaxWidthPx}px`,
                          }}
                        />
                      </div>
                    )}
                    <h1
                      className={cn(
                        'text-2xl tracking-tight',
                        pdfConfig.fontWeight === 'EXTRA_BOLD' ? 'font-black' : pdfConfig.fontWeight === 'REGULAR' ? 'font-medium' : 'font-bold',
                      )}
                      style={{ color: pdfConfig.primaryColor }}
                    >
                      {company.name}
                    </h1>
                    <p className="text-xs text-neutral-500">
                      {[company.address, company.email, company.phone].filter(Boolean).join(' · ')}
                    </p>
                    <div className="inline-block px-4 py-1 rounded border text-xs font-bold uppercase tracking-wider" style={{ borderColor: pdfConfig.primaryColor, color: pdfConfig.primaryColor, backgroundColor: pdfConfig.bandColor }}>
                      COMMERCIAL INVOICE
                    </div>
                  </div>
                )}

                {/* HEADER LAYOUT: MODERN_SPLIT (Classic Default & Split Style) */}
                {pdfConfig.headerLayout === 'MODERN_SPLIT' && (
                  <div className="flex items-start justify-between border-b pb-4">
                    <div>
                      {pdfConfig.showLogo ? (
                        company.logoUrl ? (
                          <div className="flex items-center gap-3">
                            <img
                              src={company.logoUrl}
                              alt={company.name}
                              className="w-auto object-contain transition-all"
                              style={{
                                height: `${logoHeightPx}px`,
                                maxHeight: `${logoMaxHeightPx}px`,
                                maxWidth: `${logoMaxWidthPx}px`,
                              }}
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <div className="h-12 w-12 rounded border bg-neutral-50 p-1.5 flex flex-col items-center justify-center text-center shadow-xs">
                              <span className="text-xs font-black uppercase tracking-tight" style={{ color: pdfConfig.primaryColor }}>
                                {company.name.charAt(0)}
                              </span>
                            </div>
                            <div>
                              <h1 className="text-base font-bold tracking-tight" style={{ color: pdfConfig.primaryColor }}>
                                {company.name}
                              </h1>
                              <p className="text-[11px] text-neutral-500">{company.address}</p>
                            </div>
                          </div>
                        )
                      ) : (
                        <div>
                          <h1
                            className={cn(
                              'text-xl tracking-tight',
                              pdfConfig.fontWeight === 'EXTRA_BOLD' ? 'font-black' : pdfConfig.fontWeight === 'REGULAR' ? 'font-normal' : 'font-bold',
                            )}
                            style={{ color: pdfConfig.primaryColor }}
                          >
                            {company.name}
                          </h1>
                          <p className="text-xs text-neutral-500">{company.address}</p>
                        </div>
                      )}
                    </div>

                    <div className="text-right">
                      <div
                        className={cn(
                          'text-2xl tracking-tight',
                          pdfConfig.fontWeight === 'EXTRA_BOLD' ? 'font-black' : pdfConfig.fontWeight === 'REGULAR' ? 'font-normal' : 'font-bold',
                        )}
                        style={{ color: pdfConfig.darkColor }}
                      >
                        Invoice
                      </div>
                      <p className="text-xs text-neutral-500 mt-1">{company.name}</p>
                      <p className="text-xs text-neutral-500">{company.address}</p>
                      <p className="text-xs text-neutral-500">{company.phone}</p>
                      <p className="text-xs text-neutral-500">{company.email}</p>
                    </div>
                  </div>
                )}

                {/* INFO BAND (BILL TO & BILL INFO) */}
                <div
                  className="rounded-sm p-4 border flex flex-col sm:flex-row justify-between gap-4"
                  style={{
                    backgroundColor: pdfConfig.bandColor,
                    borderColor: pdfConfig.lightColor,
                    borderLeftWidth: pdfConfig.presetId === 'classic_default' ? '1px' : '4px',
                    borderLeftColor: pdfConfig.primaryColor,
                  }}
                >
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                      BILL TO
                    </div>
                    <div className="text-xs font-bold" style={{ color: pdfConfig.darkColor }}>
                      Client / Company Name
                    </div>
                    <div className="text-[11px] text-neutral-600">+1 (555) 019-2834</div>
                  </div>

                  <div className="space-y-1 text-right">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                      BILL INFO
                    </div>
                    <div className="text-xs font-bold" style={{ color: pdfConfig.darkColor }}>
                      Invoice # <span className="font-mono">00014</span>
                    </div>
                    <div className="text-[11px] text-neutral-600">Date: <span className="font-bold text-neutral-800">August 21, 2026</span></div>
                  </div>
                </div>

                {/* LINE ITEMS TABLE */}
                <div className="space-y-2">
                  <div
                    className={cn(
                      'grid grid-cols-12 py-2 px-3 text-[10px] font-bold uppercase tracking-wider rounded-t',
                      pdfConfig.tableStyle === 'BORDERED' && 'border',
                    )}
                    style={{
                      backgroundColor: pdfConfig.presetId === 'classic_default' ? 'transparent' : pdfConfig.bandColor,
                      color: pdfConfig.primaryColor,
                      borderColor: pdfConfig.lightColor,
                      borderBottom: '1px solid ' + pdfConfig.lightColor,
                    }}
                  >
                    <div className="col-span-6 font-bold">Item</div>
                    <div className="col-span-2 text-right font-bold">Quantity</div>
                    <div className="col-span-2 text-right font-bold">Price</div>
                    <div className="col-span-2 text-right font-bold">Amount</div>
                  </div>

                  {/* Sample Row */}
                  {[
                    { name: 'Commercial Equipment / Service Package', qty: 1, price: '$725.00', total: '$725.00' },
                  ].map((row, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        'grid grid-cols-12 py-2.5 px-3 text-xs items-center',
                        pdfConfig.tableStyle === 'STRIPED' && idx % 2 === 1 && 'rounded',
                        pdfConfig.tableStyle === 'BORDERED' && 'border-b border-l border-r',
                        pdfConfig.tableStyle === 'MINIMAL_DIVIDERS' && 'border-b',
                      )}
                      style={{
                        backgroundColor: pdfConfig.tableStyle === 'STRIPED' && idx % 2 === 1 ? pdfConfig.bandColor : 'transparent',
                        borderColor: pdfConfig.lightColor,
                      }}
                    >
                      <div className="col-span-6 font-medium" style={{ color: pdfConfig.darkColor }}>
                        {row.name}
                      </div>
                      <div className="col-span-2 text-right font-mono text-neutral-600">{row.qty}</div>
                      <div className="col-span-2 text-right font-mono text-neutral-600">{row.price}</div>
                      <div className="col-span-2 text-right font-bold font-mono" style={{ color: pdfConfig.darkColor }}>
                        {row.total}
                      </div>
                    </div>
                  ))}
                </div>

                {/* TOTALS SECTION */}
                <div className="flex justify-end pt-2">
                  <div className="w-64 space-y-1.5 text-xs">
                    <div className="flex justify-between text-neutral-500 py-1 border-b" style={{ borderColor: pdfConfig.lightColor }}>
                      <span>Subtotal</span>
                      <span className="font-mono font-bold text-neutral-900">$725.00</span>
                    </div>
                    <div className="flex justify-between py-1 border-b font-bold" style={{ borderColor: pdfConfig.lightColor }}>
                      <span className="text-neutral-900">Total</span>
                      <span className="font-mono text-neutral-900">$725.00</span>
                    </div>
                    <div className="flex justify-between py-1 border-b" style={{ borderColor: pdfConfig.lightColor }}>
                      <span className="text-neutral-500">Paid</span>
                      <span className="font-mono font-bold text-neutral-900">$725.00</span>
                    </div>
                    <div className="flex justify-between py-1 font-bold">
                      <span className="text-neutral-900">Balance due</span>
                      <span className="font-mono text-neutral-900">$0.00</span>
                    </div>
                  </div>
                </div>

                {/* AUTHORIZED SIGNATURE & STAMP BLOCK */}
                {pdfConfig.showSignature && (
                  <div className="flex justify-end pt-4">
                    <div className="w-56 text-center space-y-1">
                      {/* Stylized Handwritten Signature rendering */}
                      <div className="min-h-12 border-b border-dashed border-neutral-400 flex flex-col items-center justify-end pb-1">
                        {pdfConfig.signatureSignerName ? (
                          <span
                            className="text-2xl select-none leading-none"
                            style={{
                              fontFamily: getSignatureFontFamily(),
                              color: pdfConfig.primaryColor,
                            }}
                          >
                            {pdfConfig.signatureSignerName}
                          </span>
                        ) : (
                          <span className="text-[9px] text-neutral-300 italic">Signature & Official Stamp</span>
                        )}
                      </div>
                      <div className="text-[11px] font-bold text-neutral-800">
                        {pdfConfig.signatureTitle || 'Authorized Signature & Stamp'}
                      </div>
                      {pdfConfig.signatureSignerName && (
                        <div className="text-[10px] text-neutral-500 font-medium">
                          {pdfConfig.signatureSignerName}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* FOOTER NOTE */}
                <div className="border-t pt-4 text-[10px] text-neutral-500 space-y-3" style={{ borderColor: pdfConfig.lightColor }}>
                  <p className="text-neutral-500">
                    {pdfConfig.footerNote || `Thank you for choosing ${company.name}. We appreciate your business and look forward to serving you again.`}
                  </p>
                  <div className="text-right">
                    <div className="font-bold text-neutral-900">{company.name}</div>
                    <div className="text-[9px] text-neutral-400">August 22, 2026</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
