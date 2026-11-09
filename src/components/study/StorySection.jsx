/** StorySection — story_md through the safe Markdown subset. */
import { Markdown } from './markdown.jsx'
import { hasText } from './data.js'
import { Section } from './primitives.jsx'

export default function StorySection({ title, story_md }) {
  if (!hasText(story_md)) return null
  return (
    <Section id="story" title={title} className="st-story">
      <Markdown source={story_md} keyPrefix="story" />
    </Section>
  )
}
