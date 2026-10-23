import { EVENT_ACCENTS } from "../../../lib/eventAccent";
import { layoutForImage } from "../../../lib/heroImage";
import type { AccentChoice, HeroLayout, PageDoc } from "../../../lib/pageDocument";
import { CongressSignature } from "../../brand/CongressSignature";
import { Icon } from "../../ui/Icon";
import { FocalPointField, ImageField, LocalizedField } from "./StudioFields";
import { useStudio } from "./studioContext";

function LayoutThumb({ layout }: { layout: HeroLayout }) {
  return (
    <span aria-hidden="true" className="relative block h-16 overflow-hidden rounded-lg bg-surface-ink">
      {layout === "signature" && <CongressSignature seed="layout-thumb" tone="ink" className="absolute inset-0 size-full scale-125" />}
      {layout === "banner" && <span className="absolute inset-x-2 top-2 h-6 rounded-md bg-[linear-gradient(135deg,#6f5ad8,#d48ad8_55%,#f3c7a8)]" />}
      {layout === "cover" && <span className="absolute inset-0 bg-[linear-gradient(135deg,#6f5ad8,#d48ad8_55%,#f3c7a8)] opacity-80" />}
      {layout === "cover" && <span className="absolute inset-0 bg-linear-to-t from-surface-ink via-surface-ink/60 to-transparent" />}
      {layout === "split" && <span className="absolute inset-y-2 end-2 w-[38%] rounded-md bg-[linear-gradient(135deg,#6f5ad8,#d48ad8_55%,#f3c7a8)] [border-start-end-radius:14px]" />}
      <span className="absolute start-2 bottom-3 h-1.5 w-12 rounded-full bg-white/90" />
      <span className="absolute start-2 bottom-6 h-1 w-8 rounded-full bg-white/50" />
    </span>
  );
}

export function BrandPanel({ doc, onChange, eventName }: { doc: PageDoc; onChange: (next: PageDoc) => void; eventName: string }) {
  const { copy, images } = useStudio();
  const b = copy.brand;
  const hero = doc.hero;
  const setHero = (patch: Partial<PageDoc["hero"]>) => onChange({ ...doc, hero: { ...hero, ...patch } });
  const accents: Array<{ value: AccentChoice; label: string; colour: string | null }> = [
    { value: "auto", label: b.auto, colour: null },
    ...EVENT_ACCENTS.map((a) => ({ value: a.name, label: a.name, colour: a.accent })),
  ];
  const layouts: Array<{ value: HeroLayout; label: string; hint: string }> = [
    { value: "signature", label: b.signature, hint: b.signatureHint },
    { value: "banner", label: b.banner, hint: b.bannerHint },
    { value: "cover", label: b.cover, hint: b.coverHint },
    { value: "split", label: b.split, hint: b.splitHint },
  ];
  const cover = hero.cover_asset_id ? images[hero.cover_asset_id] : undefined;

  return (
    <div className="space-y-8">
      <fieldset className="space-y-2">
        <legend className="ui-label">{b.accent}</legend>
        <div className="flex flex-wrap gap-2">
          {accents.map((a) => (
            <label
              key={a.value}
              title={a.label}
              className={`relative grid size-11 cursor-pointer place-items-center rounded-full border-2 transition-transform has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring ${
                doc.branding.accent === a.value ? "scale-105 border-text-primary" : "border-transparent hover:scale-105"
              }`}
            >
              <input
                type="radio"
                name="page-accent"
                className="sr-only"
                checked={doc.branding.accent === a.value}
                onChange={() => onChange({ ...doc, branding: { ...doc.branding, accent: a.value } })}
                aria-label={a.label}
              />
              {a.colour ? (
                <span className="size-8 rounded-full shadow-soft" style={{ background: a.colour }} />
              ) : (
                <span className="grid size-8 place-items-center rounded-full bg-[conic-gradient(#2000CD,#B8017A,#2236D4,#5122D6,#8E1BA8,#2000CD)] text-white">
                  <Icon name="sync" size={14} />
                </span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <ImageField
        label={b.logo}
        aspect="logo"
        value={doc.branding.logo_asset_id}
        onChange={(logo_asset_id) => onChange({ ...doc, branding: { ...doc.branding, logo_asset_id } })}
        hint={b.logoHint}
      />

      <fieldset className="space-y-2">
        <legend className="ui-label">{b.heroLayout}</legend>
        <div className="grid grid-cols-2 gap-2">
          {layouts.map((l) => (
            <label
              key={l.value}
              className={`cursor-pointer space-y-2 rounded-xl border p-2 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring ${
                hero.layout === l.value ? "border-aiteb-indigo bg-aiteb-lavender/60" : "border-border-default hover:border-border-strong"
              }`}
            >
              <input type="radio" name="hero-layout" className="sr-only" checked={hero.layout === l.value} onChange={() => setHero({ layout: l.value })} />
              <LayoutThumb layout={l.value} />
              <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-text-primary">
                {l.label}
                {l.value === "banner" && (
                  <span className="rounded-full bg-aiteb-lavender px-1.5 py-px text-caption font-semibold text-aiteb-indigo">{b.recommended}</span>
                )}
              </span>
              <span className="block text-caption leading-snug text-text-muted">{l.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <ImageField
        label={b.coverImage}
        value={hero.cover_asset_id}
        onChange={(cover_asset_id) => setHero({ cover_asset_id, layout: layoutForImage(hero, cover_asset_id) })}
        hint={
          hero.layout === "signature"
            ? hero.cover_asset_id
              ? undefined
              : b.imageHint.signature
            : hero.cover_asset_id
              ? b.imageHint[hero.layout]
              : b.coverNeeded
        }
      />

      {cover && (hero.layout === "cover" || hero.layout === "split") && (
        <FocalPointField
          label={b.focal}
          hint={b.focalHint}
          image={cover}
          x={hero.focal_x}
          y={hero.focal_y}
          // A phone image of its own is shown whole-screen as composed; the focal point is for the main image.
          phone={!(hero.layout === "cover" && hero.mobile_cover_asset_id)}
          onChange={(focal_x, focal_y) => setHero({ focal_x, focal_y })}
        />
      )}

      {hero.layout === "cover" && (
        <ImageField
          label={b.mobileImage}
          aspect="portrait"
          value={hero.mobile_cover_asset_id}
          onChange={(mobile_cover_asset_id) => setHero({ mobile_cover_asset_id })}
          hint={b.mobileImageHint}
        />
      )}

      <div className="space-y-4 border-t border-border-subtle pt-6">
        <p className="text-sm font-bold text-text-primary">{b.heroTexts}</p>
        <LocalizedField label={b.eyebrow} value={hero.eyebrow} maxLength={160} onChange={(eyebrow) => setHero({ eyebrow })} emptyNote={copy.defaultNote} />
        <LocalizedField label={b.heroTitle} value={hero.title} maxLength={500} onChange={(title) => setHero({ title })} emptyNote={b.heroTitleHint(eventName)} />
        <LocalizedField label={b.subtitle} value={hero.subtitle} multiline rows={3} maxLength={500} onChange={(subtitle) => setHero({ subtitle })} />
        <LocalizedField label={b.ctaLabel} value={hero.cta_label} maxLength={160} onChange={(cta_label) => setHero({ cta_label })} emptyNote={copy.defaultNote} />
      </div>

      <label className="block border-t border-border-subtle pt-6">
        <span className="ui-label">{b.language}</span>
        <select
          className="ui-select"
          value={doc.primary_locale}
          onChange={(e) => onChange({ ...doc, primary_locale: e.target.value as PageDoc["primary_locale"] })}
        >
          <option value="auto">{b.languageAuto}</option>
          <option value="fa">{copy.languages.fa}</option>
          <option value="en">{copy.languages.en}</option>
        </select>
        <span className="mt-1.5 block text-xs leading-relaxed text-text-muted">{b.languageHint}</span>
      </label>
    </div>
  );
}
