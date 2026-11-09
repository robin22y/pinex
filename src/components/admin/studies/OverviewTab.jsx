/** Overview tab: identity, listing, reporting, card/intro text, images. */
import { ACCOUNTING_OPTIONS, MONTH_OPTIONS, UNIT_OPTIONS } from './config.js'
import MediaField from './MediaPicker.jsx'
import { Field, PlainInput } from './ui.jsx'

const F = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra })

const GROUPS = [
  {
    title: 'Identity',
    fields: [
      F('name', 'Company name', 'text', { required: true }),
      F('slug', 'Slug (URL)', 'text', { required: true }),
      F('label', 'Label', 'text', { placeholder: 'Company Study', help: 'Eyebrow above the headline.' }),
      F('featured', 'Featured', 'checkbox'),
    ],
  },
  {
    title: 'Listing',
    fields: [
      F('country', 'Country', 'text', { placeholder: 'IN', upper: true, maxLength: 2, help: 'ISO 2-letter code.' }),
      F('exchange', 'Exchange', 'text', { placeholder: 'NSE', upper: true }),
      F('ticker', 'Ticker', 'text', { upper: true }),
      F('isin', 'ISIN', 'text', { upper: true, maxLength: 12, placeholder: 'INE123A01016' }),
      F('sector', 'Sector'),
      F('industry', 'Industry'),
      F('website', 'Website', 'url'),
    ],
  },
  {
    title: 'Reporting',
    fields: [
      F('reporting_currency', 'Reporting currency', 'text', { placeholder: 'INR', upper: true, maxLength: 3 }),
      F('reporting_unit', 'Reporting unit', 'select', { options: UNIT_OPTIONS }),
      F('accounting_standard', 'Accounting standard', 'select', { options: ACCOUNTING_OPTIONS }),
      F('fiscal_year_end_month', 'Fiscal year ends', 'select', { options: MONTH_OPTIONS }),
    ],
  },
  {
    title: 'Intro and card',
    fields: [
      F('headline', 'Headline', 'text', { wide: true }),
      F('story_hook', 'Story hook', 'textarea', { wide: true, rows: 3 }),
      F('summary', 'Summary', 'textarea', { wide: true, rows: 3 }),
      F('card_title', 'Card title', 'text', { wide: true, help: 'Blank = headline.' }),
      F('card_summary', 'Card summary', 'textarea', { wide: true, rows: 2, help: 'Blank = summary.' }),
      F('read_time_minutes', 'Read time (minutes)', 'number', { min: 1, max: 600 }),
    ],
  },
]

const IMAGES = [
  ['hero_image_id', 'Hero image'],
  ['card_image_id', 'Card image', 'Blank = hero image.'],
  ['logo_image_id', 'Logo'],
]

export default function OverviewTab({ draft, setField, computedMinutes, slugNote }) {
  return (
    <div className="sa-tabpanel">
      {GROUPS.map((g) => (
        <fieldset key={g.title} className="sa-fieldset">
          <legend>{g.title}</legend>
          <div className="sa-grid2">
            {g.fields.map((f) => {
              const value = f.key === 'fiscal_year_end_month' && draft[f.key] != null ? String(draft[f.key]) : draft[f.key]
              return (
                <Field
                  key={f.key}
                  label={f.label}
                  required={f.required}
                  wide={f.wide}
                  help={f.key === 'slug' ? undefined : f.help}
                  error={f.key === 'slug' ? slugNote?.error : undefined}
                >
                  <PlainInput
                    field={f}
                    value={value}
                    onChange={(v) => setField(f.key, v)}
                    placeholder={f.key === 'read_time_minutes' ? `Auto: ${computedMinutes}` : undefined}
                  />
                  {f.key === 'slug' && slugNote?.info && <span className="sa-help">{slugNote.info}</span>}
                  {f.key === 'read_time_minutes' && <span className="sa-help">Blank = computed from the text ({computedMinutes} min).</span>}
                </Field>
              )
            })}
          </div>
        </fieldset>
      ))}
      <fieldset className="sa-fieldset">
        <legend>Images</legend>
        <div className="sa-grid3">
          {IMAGES.map(([key, label, help]) => (
            <Field key={key} label={label} help={help}>
              <MediaField value={draft[key] ?? null} onChange={(v) => setField(key, v)} />
            </Field>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
