import {
  LINK_KINDS,
  emptyColumn,
  localized,
  type GalleryItem,
  type HighlightItem,
  type LinkItem,
  type LocalizedText,
  type PageSection,
  type SectionStyle,
} from "../../../lib/pageDocument";
import { detectLinkKind, linkDisplay } from "../../../lib/pageLinks";
import { Choice, IconPicker, ImageField, ItemList, LinkField, LocalizedField, VideoUrlField } from "./StudioFields";
import { Icon } from "../../ui/Icon";
import { useStudio } from "./studioContext";

const empty = (): LocalizedText => ({ fa: "", en: "" });

/** The fields of one section, then its appearance. */
export function SectionEditor(props: { section: PageSection; onChange: (next: PageSection) => void; eventDescription: string }) {
  return (
    <>
      <SectionFields {...props} />
      <StyleFields section={props.section} onChange={props.onChange} />
    </>
  );
}

/** Sections whose look is their own: no background band (mirrors `CongressPage`). */
const UNBANDED: ReadonlyArray<PageSection["type"]> = ["passes", "exhibitors", "cta"];

/** Curated presentation of a section, folded away until wanted. */
function StyleFields({ section, onChange }: { section: PageSection; onChange: (next: PageSection) => void }) {
  const { copy } = useStudio();
  const st = copy.style;
  const style = section.style;
  const set = (patch: Partial<SectionStyle>) => onChange({ ...section, style: { ...style, ...patch } });
  const changed = style.background !== "none" || style.width !== "normal" || style.align !== "start" || style.text_size !== "md" || style.direction !== "auto";
  return (
    <details className="group rounded-2xl border border-border-default bg-surface-panel" open={changed || undefined}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-text-primary [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <Icon name="palette" size={17} className="text-text-muted" />
          {st.title}
        </span>
        <Icon name="chevron-down" size={17} className="text-text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-border-default p-4">
        {!UNBANDED.includes(section.type) && (
          <Choice
            label={st.background}
            value={style.background}
            options={[
              { value: "none", label: st.none },
              { value: "subtle", label: st.subtle },
              { value: "accent", label: st.accent },
              { value: "ink", label: st.ink },
            ]}
            onChange={(background) => set({ background })}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Choice
            label={st.width}
            value={style.width}
            options={[
              { value: "normal", label: st.normal },
              { value: "narrow", label: st.narrow },
            ]}
            onChange={(width) => set({ width })}
          />
          <Choice
            label={st.align}
            value={style.align}
            options={[
              { value: "start", label: st.start },
              { value: "center", label: st.center },
            ]}
            onChange={(align) => set({ align })}
          />
        </div>
        <Choice
          label={st.textSize}
          value={style.text_size}
          options={[
            { value: "sm", label: st.sm },
            { value: "md", label: st.md },
            { value: "lg", label: st.lg },
          ]}
          onChange={(text_size) => set({ text_size })}
        />
        <div className="space-y-1.5">
          <Choice
            label={st.direction}
            value={style.direction}
            options={[
              { value: "auto", label: st.auto },
              { value: "rtl", label: st.rtl },
              { value: "ltr", label: st.ltr },
            ]}
            onChange={(direction) => set({ direction })}
          />
          <p className="text-xs leading-relaxed text-text-muted">{st.directionHint}</p>
        </div>
      </div>
    </details>
  );
}

/** The fields one section type exposes — nothing more. Core sections edit presentation only. */
function SectionFields({ section, onChange, eventDescription }: { section: PageSection; onChange: (next: PageSection) => void; eventDescription: string }) {
  const { copy, lang } = useStudio();
  const f = copy.fields;
  const L = copy.layouts;
  const headingFields = (
    <>
      <LocalizedField label={f.eyebrow} value={section.eyebrow} maxLength={160} onChange={(eyebrow) => onChange({ ...section, eyebrow })} emptyNote={copy.defaultNote} />
      <LocalizedField label={f.title} value={section.title} maxLength={160} onChange={(title) => onChange({ ...section, title })} emptyNote={copy.defaultNote} />
    </>
  );
  const summary = (value: LocalizedText) => localized(value, lang) ?? "";

  switch (section.type) {
    case "about":
      return (
        <>
          {headingFields}
          <LocalizedField
            label={f.body}
            value={section.body}
            multiline
            rows={7}
            maxLength={8000}
            onChange={(body) => onChange({ ...section, body })}
            emptyNote={eventDescription ? copy.eventValueNote(copy.eventDescription) : copy.defaultNote}
            hint={copy.markdownHint}
            markdown
          />
        </>
      );
    case "passes":
    case "exhibitors":
      return (
        <>
          {headingFields}
          <LocalizedField label={f.lead} value={section.lead} multiline rows={3} maxLength={500} onChange={(lead) => onChange({ ...section, lead })} emptyNote={copy.defaultNote} />
        </>
      );
    case "highlights":
      return (
        <>
          <Choice
            label={f.layout}
            value={section.layout}
            options={[
              { value: "list", label: L.list, icon: "list" },
              { value: "cards", label: L.cards, icon: "grid" },
            ]}
            onChange={(layout) => onChange({ ...section, layout })}
          />
          {headingFields}
          <ItemList
            items={section.items}
            max={8}
            create={(): HighlightItem => ({ icon: "check-circle", title: empty(), body: empty() })}
            summary={(item) => summary(item.title)}
            onChange={(items) => onChange({ ...section, items })}
            render={(item, update) => (
              <>
                <IconPicker value={item.icon} onChange={(icon) => update({ ...item, icon: icon ?? "check-circle" })} />
                <LocalizedField label={f.title} value={item.title} maxLength={160} onChange={(title) => update({ ...item, title })} />
                <LocalizedField label={f.body} value={item.body} multiline rows={2} maxLength={500} onChange={(body) => update({ ...item, body })} />
              </>
            )}
          />
        </>
      );
    case "rich_text":
      return (
        <>
          <Choice
            label={f.layout}
            value={section.layout}
            options={[
              { value: "split", label: L.split },
              { value: "centered", label: L.centered },
              { value: "columns", label: L.columns },
            ]}
            onChange={(layout) => onChange({ ...section, layout })}
          />
          {headingFields}
          <LocalizedField label={f.body} value={section.body} multiline rows={9} maxLength={8000} onChange={(body) => onChange({ ...section, body })} hint={copy.markdownHint} markdown />
        </>
      );
    case "image_text":
      return (
        <>
          <Choice
            label={f.layout}
            value={section.layout}
            options={[
              { value: "image_start", label: L.image_start },
              { value: "image_end", label: L.image_end },
            ]}
            onChange={(layout) => onChange({ ...section, layout })}
          />
          <ImageField label={f.image} value={section.image_asset_id} onChange={(image_asset_id) => onChange({ ...section, image_asset_id })} />
          <LocalizedField label={f.imageAlt} value={section.image_alt} maxLength={160} onChange={(image_alt) => onChange({ ...section, image_alt })} />
          {headingFields}
          <LocalizedField label={f.body} value={section.body} multiline rows={7} maxLength={8000} onChange={(body) => onChange({ ...section, body })} hint={copy.markdownHint} markdown />
        </>
      );
    case "faq":
      return (
        <>
          {headingFields}
          <ItemList
            items={section.items}
            max={24}
            create={() => ({ question: empty(), answer: empty() })}
            summary={(item) => summary(item.question)}
            onChange={(items) => onChange({ ...section, items })}
            render={(item, update) => (
              <>
                <LocalizedField label={f.question} value={item.question} maxLength={500} onChange={(question) => update({ ...item, question })} />
                <LocalizedField label={f.answer} value={item.answer} multiline rows={3} maxLength={8000} onChange={(answer) => update({ ...item, answer })} markdown />
              </>
            )}
          />
        </>
      );
    case "cta":
      return (
        <>
          <Choice
            label={f.layout}
            value={section.layout}
            options={[
              { value: "ink", label: L.ink },
              { value: "accent", label: L.accent },
            ]}
            onChange={(layout) => onChange({ ...section, layout })}
          />
          <LocalizedField label={f.title} value={section.title} maxLength={160} onChange={(title) => onChange({ ...section, title })} emptyNote={copy.defaultNote} />
          <LocalizedField label={f.body} value={section.body} multiline rows={3} maxLength={500} onChange={(body) => onChange({ ...section, body })} />
          <LocalizedField label={f.buttonLabel} value={section.button_label} maxLength={160} onChange={(button_label) => onChange({ ...section, button_label })} emptyNote={copy.defaultNote} />
          <Choice
            label={f.target}
            value={section.target}
            options={[
              { value: "passes", label: f.targetPasses, icon: "ticket" },
              { value: "exhibitors", label: f.targetExhibitors, icon: "booth" },
              { value: "url", label: f.targetUrl, icon: "link" },
            ]}
            onChange={(target) => onChange({ ...section, target })}
          />
          {section.target === "url" && <LinkField label={f.url} value={section.url} onChange={(url) => onChange({ ...section, url })} hint={f.urlHint} />}
        </>
      );
    case "speakers":
      return (
        <>
          {headingFields}
          <LocalizedField label={f.lead} value={section.lead} multiline rows={2} maxLength={500} onChange={(lead) => onChange({ ...section, lead })} />
          <ItemList
            items={section.items}
            max={32}
            create={() => ({ name: empty(), role: empty(), affiliation: empty(), photo_asset_id: null })}
            summary={(item) => summary(item.name)}
            onChange={(items) => onChange({ ...section, items })}
            render={(item, update) => (
              <>
                <ImageField label={f.photo} aspect="square" value={item.photo_asset_id} onChange={(photo_asset_id) => update({ ...item, photo_asset_id })} />
                <LocalizedField label={f.name} value={item.name} maxLength={160} onChange={(name) => update({ ...item, name })} />
                <LocalizedField label={f.role} value={item.role} maxLength={160} onChange={(role) => update({ ...item, role })} />
                <LocalizedField label={f.affiliation} value={item.affiliation} maxLength={160} onChange={(affiliation) => update({ ...item, affiliation })} />
              </>
            )}
          />
        </>
      );
    case "agenda":
      return (
        <>
          {headingFields}
          <LocalizedField label={f.lead} value={section.lead} multiline rows={2} maxLength={500} onChange={(lead) => onChange({ ...section, lead })} />
          <ItemList
            items={section.items}
            max={48}
            create={() => ({ time: "", title: empty(), detail: empty() })}
            summary={(item) => [item.time, summary(item.title)].filter(Boolean).join(" · ")}
            onChange={(items) => onChange({ ...section, items })}
            render={(item, update) => (
              <>
                <label className="block">
                  <span className="ui-label">{f.time}</span>
                  <input type="text" className="ui-input" maxLength={40} value={item.time} placeholder="09:30" onChange={(e) => update({ ...item, time: e.target.value })} />
                </label>
                <LocalizedField label={f.title} value={item.title} maxLength={500} onChange={(title) => update({ ...item, title })} />
                <LocalizedField label={f.detail} value={item.detail} multiline rows={2} maxLength={500} onChange={(detail) => update({ ...item, detail })} />
              </>
            )}
          />
        </>
      );
    case "columns":
      return (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Choice
              label={f.layout}
              value={section.layout}
              options={[
                { value: "equal", label: L.equal },
                { value: "wide_start", label: L.wide_start },
                { value: "wide_end", label: L.wide_end },
              ]}
              onChange={(layout) => onChange({ ...section, layout })}
            />
            <Choice
              label={f.surface}
              value={section.surface}
              options={[
                { value: "plain", label: L.plain },
                { value: "cards", label: L.cards, icon: "grid" },
              ]}
              onChange={(surface) => onChange({ ...section, surface })}
            />
          </div>
          {headingFields}
          <ItemList
            items={section.items}
            max={4}
            create={emptyColumn}
            summary={(item, i) => summary(item.title) || `${f.column} ${i + 1}`}
            onChange={(items) => onChange({ ...section, items })}
            render={(item, update) => (
              <>
                <IconPicker allowNone value={item.icon} onChange={(icon) => update({ ...item, icon })} />
                <ImageField label={f.image} value={item.image_asset_id} onChange={(image_asset_id) => update({ ...item, image_asset_id })} />
                {item.image_asset_id && (
                  <LocalizedField label={f.imageAlt} value={item.image_alt} maxLength={160} onChange={(image_alt) => update({ ...item, image_alt })} />
                )}
                <LocalizedField label={f.title} value={item.title} maxLength={160} onChange={(title) => update({ ...item, title })} />
                <LocalizedField label={f.body} value={item.body} multiline rows={5} maxLength={8000} onChange={(body) => update({ ...item, body })} hint={copy.markdownHint} markdown />
                <LinkField label={f.buttonUrl} value={item.button_url} onChange={(button_url) => update({ ...item, button_url })} hint={f.urlHint} />
                {item.button_url && (
                  <LocalizedField label={f.buttonLabel} value={item.button_label} maxLength={160} onChange={(button_label) => update({ ...item, button_label })} emptyNote={copy.defaultNote} />
                )}
              </>
            )}
          />
        </>
      );
    case "video":
      return (
        <>
          <VideoUrlField provider={section.provider} videoId={section.video_id} onChange={(video) => onChange({ ...section, ...video })} />
          <Choice
            label={f.layout}
            value={section.layout}
            options={[
              { value: "full", label: L.full },
              { value: "video_start", label: L.video_start },
              { value: "video_end", label: L.video_end },
            ]}
            onChange={(layout) => onChange({ ...section, layout })}
          />
          <ImageField label={f.poster} value={section.poster_asset_id} onChange={(poster_asset_id) => onChange({ ...section, poster_asset_id })} hint={f.posterHint} />
          {headingFields}
          <LocalizedField label={f.caption} value={section.caption} maxLength={500} onChange={(caption) => onChange({ ...section, caption })} />
          <LocalizedField label={f.body} value={section.body} multiline rows={5} maxLength={8000} onChange={(body) => onChange({ ...section, body })} hint={copy.markdownHint} markdown />
        </>
      );
    case "gallery":
      return (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Choice
              label={f.layout}
              value={section.layout}
              options={[
                { value: "grid", label: L.grid, icon: "image" },
                { value: "logos", label: L.logos, icon: "grid" },
              ]}
              onChange={(layout) => onChange({ ...section, layout })}
            />
            <Choice
              label={f.galleryColumns}
              value={String(section.columns) as "2" | "3" | "4"}
              options={[
                { value: "2", label: "2" },
                { value: "3", label: "3" },
                { value: "4", label: "4" },
              ]}
              onChange={(columns) => onChange({ ...section, columns: Number(columns) as 2 | 3 | 4 })}
            />
          </div>
          {headingFields}
          <ItemList
            items={section.items}
            max={24}
            create={(): GalleryItem => ({ image_asset_id: null, alt: empty(), caption: empty(), url: "" })}
            summary={(item, i) => summary(item.caption) || summary(item.alt) || `${f.image} ${i + 1}`}
            onChange={(items) => onChange({ ...section, items })}
            render={(item, update) => (
              <>
                <ImageField
                  label={f.image}
                  aspect={section.layout === "logos" ? "logo" : "wide"}
                  value={item.image_asset_id}
                  onChange={(image_asset_id) => update({ ...item, image_asset_id })}
                />
                <LocalizedField label={f.imageAlt} value={item.alt} maxLength={160} onChange={(alt) => update({ ...item, alt })} />
                <LocalizedField label={f.caption} value={item.caption} maxLength={160} onChange={(caption) => update({ ...item, caption })} />
                <LinkField label={f.buttonUrl} value={item.url} onChange={(url) => update({ ...item, url })} hint={f.urlHint} />
              </>
            )}
          />
        </>
      );
    case "links":
      return (
        <>
          <Choice
            label={f.layout}
            value={section.layout}
            options={[
              { value: "buttons", label: L.buttons },
              { value: "cards", label: L.linkCards, icon: "grid" },
            ]}
            onChange={(layout) => onChange({ ...section, layout })}
          />
          {headingFields}
          <LocalizedField label={f.lead} value={section.lead} multiline rows={2} maxLength={500} onChange={(lead) => onChange({ ...section, lead })} />
          <ItemList
            items={section.items}
            max={12}
            create={(): LinkItem => ({ kind: "website", url: "", label: empty() })}
            summary={(item) => summary(item.label) || (item.url ? `${copy.linkKinds[item.kind]} · ${linkDisplay(item.url)}` : "")}
            onChange={(items) => onChange({ ...section, items })}
            render={(item, update) => (
              <>
                <LinkField
                  label={f.url}
                  value={item.url}
                  placeholder="t.me/…  ·  instagram.com/…  ·  info@…"
                  // The kind follows the address (t.me → Telegram); the organizer can still pick another.
                  onChange={(url) => update({ ...item, url, kind: url ? detectLinkKind(url) : item.kind })}
                  hint={item.url ? f.linkDetected(copy.linkKinds[item.kind]) : f.urlHint}
                />
                <label className="block">
                  <span className="ui-label">{f.linkKind}</span>
                  <select className="ui-input" value={item.kind} onChange={(e) => update({ ...item, kind: e.target.value as LinkItem["kind"] })}>
                    {LINK_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {copy.linkKinds[kind]}
                      </option>
                    ))}
                  </select>
                </label>
                <LocalizedField
                  label={f.linkLabel}
                  value={item.label}
                  maxLength={160}
                  onChange={(label) => update({ ...item, label })}
                  emptyNote={f.linkLabelNote(copy.linkKinds[item.kind])}
                />
              </>
            )}
          />
        </>
      );
  }
}
