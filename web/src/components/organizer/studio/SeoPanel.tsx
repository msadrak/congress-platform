import { localized, type PageDoc } from "../../../lib/pageDocument";
import { Bidi } from "../../public/Bidi";
import { proseDir } from "../../public/copy";
import { Icon } from "../../ui/Icon";
import { ImageField, LocalizedField } from "./StudioFields";
import { useStudio } from "./studioContext";

export function SeoPanel({ doc, onChange, eventName, slug }: { doc: PageDoc; onChange: (next: PageDoc) => void; eventName: string; slug: string }) {
  const { copy, lang, images } = useStudio();
  const s = copy.seo;
  const seo = doc.seo;
  const set = (patch: Partial<PageDoc["seo"]>) => onChange({ ...doc, seo: { ...seo, ...patch } });
  const title = localized(seo.title, lang) ?? localized(doc.hero.title, lang) ?? eventName;
  const description = localized(seo.description, lang) ?? localized(doc.hero.subtitle, lang) ?? "";
  const shareId = seo.share_image_asset_id ?? doc.hero.cover_asset_id;
  const share = shareId ? images[shareId] : undefined;
  const host = typeof window !== "undefined" ? window.location.host : "";

  return (
    <div className="space-y-6">
      <LocalizedField label={s.title} value={seo.title} maxLength={160} onChange={(value) => set({ title: value })} emptyNote={s.titleHint} />
      <LocalizedField label={s.description} value={seo.description} multiline rows={3} maxLength={500} onChange={(value) => set({ description: value })} emptyNote={s.descriptionHint} />
      <ImageField label={s.image} value={seo.share_image_asset_id} onChange={(id) => set({ share_image_asset_id: id })} hint={s.imageHint} />

      <div className="space-y-2">
        <p className="ui-label">{s.cardPreview}</p>
        <div className="overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
          <div className="relative aspect-[1200/630] bg-surface-ink">
            {share?.url ? <img src={share.url} alt="" className="size-full object-cover" /> : <Icon name="image" size={28} className="absolute inset-0 m-auto text-ink-400" />}
          </div>
          <div className="space-y-1 border-t border-border-subtle px-4 py-3">
            <p className="font-mono text-caption text-text-muted" dir="ltr">
              {host}/e/{slug}
            </p>
            <p className="line-clamp-2 text-sm font-semibold text-text-primary">
              <Bidi text={title} />
            </p>
            {description && (
              <p {...proseDir(description)} className="line-clamp-2 text-xs text-text-secondary">
                {description}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
