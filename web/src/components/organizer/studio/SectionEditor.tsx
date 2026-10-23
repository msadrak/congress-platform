import {
  HIGHLIGHT_ICONS,
  localized,
  type HighlightItem,
  type LocalizedText,
  type PageSection,
} from "../../../lib/pageDocument";
import { Icon, type IconName } from "../../ui/Icon";
import { Choice, ImageField, ItemList, LocalizedField } from "./StudioFields";
import { useStudio } from "./studioContext";

const empty = (): LocalizedText => ({ fa: "", en: "" });

/** The fields one section type exposes — nothing more. Core sections edit presentation only. */
export function SectionEditor({ section, onChange, eventDescription }: { section: PageSection; onChange: (next: PageSection) => void; eventDescription: string }) {
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
                <fieldset>
                  <legend className="ui-label">{f.icon}</legend>
                  <div className="grid grid-cols-8 gap-1">
                    {HIGHLIGHT_ICONS.map((icon) => (
                      <label
                        key={icon}
                        title={icon}
                        className={`grid aspect-square cursor-pointer place-items-center rounded-lg border transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring ${
                          item.icon === icon ? "border-aiteb-indigo bg-aiteb-lavender text-aiteb-indigo" : "border-transparent text-text-secondary hover:bg-surface-panel-subtle"
                        }`}
                      >
                        <input type="radio" className="sr-only" checked={item.icon === icon} onChange={() => update({ ...item, icon })} aria-label={icon} />
                        <Icon name={icon as IconName} size={17} />
                      </label>
                    ))}
                  </div>
                </fieldset>
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
            ]}
            onChange={(layout) => onChange({ ...section, layout })}
          />
          {headingFields}
          <LocalizedField label={f.body} value={section.body} multiline rows={9} maxLength={8000} onChange={(body) => onChange({ ...section, body })} hint={copy.markdownHint} />
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
          <LocalizedField label={f.body} value={section.body} multiline rows={7} maxLength={8000} onChange={(body) => onChange({ ...section, body })} hint={copy.markdownHint} />
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
                <LocalizedField label={f.answer} value={item.answer} multiline rows={3} maxLength={8000} onChange={(answer) => update({ ...item, answer })} />
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
            ]}
            onChange={(target) => onChange({ ...section, target })}
          />
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
  }
}
