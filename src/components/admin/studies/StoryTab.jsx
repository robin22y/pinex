/**
 * Story tab: story_md in a plain textarea with a live preview rendered by
 * the public StorySection (side by side on wide screens, stacked on mobile),
 * then the central question and Then / Now / Next.
 */
import StorySection from '../../study/StorySection.jsx'
import '../../../styles/study.css'
import { Field } from './ui.jsx'

const AREAS = [
  ['central_question', 'Central question', 3],
  ['then_text', 'Then', 4],
  ['now_text', 'Now', 4],
  ['next_text', 'Next', 4],
]

export default function StoryTab({ draft, setField }) {
  return (
    <div className="sa-tabpanel">
      <div className="sa-story">
        <Field label="Story (Markdown)" help="Headings (##), **bold**, *italic*, [links](https://…), lists and > quotes. Raw HTML is shown as text." wide>
          <textarea className="sa-input sa-story-input" value={draft.story_md ?? ''} onChange={(e) => setField('story_md', e.target.value)} rows={24} />
        </Field>
        <div className="sa-story-preview" aria-label="Story preview">
          <p className="sa-label">Preview</p>
          <div className="study-surface">
            <article className="st-article">
              {draft.story_md?.trim() ? <StorySection title="Story" story_md={draft.story_md} /> : <p className="sa-muted">Nothing to preview yet.</p>}
            </article>
          </div>
        </div>
      </div>
      <div className="sa-grid2">
        {AREAS.map(([key, label, rows]) => (
          <Field key={key} label={label} wide={key === 'central_question'}>
            <textarea className="sa-input" rows={rows} value={draft[key] ?? ''} onChange={(e) => setField(key, e.target.value)} />
          </Field>
        ))}
      </div>
    </div>
  )
}
