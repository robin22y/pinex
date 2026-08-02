import { C } from '../../styles/tokens'

/**
 * Skeleton — a placeholder block with a sweep across it.
 *
 * Two things were wrong before. The sweep was a hardcoded white-ish
 * gradient (rgba(148,163,184,.18)), which is invisible on sepia's paper
 * surface — the blocks just sat there, inert, which is what made loading
 * feel dead rather than pending. And the keyframes were injected as a
 * <style> tag inside every instance, so a list of twenty rows put twenty
 * identical <style> nodes in the document. Both now live in index.css:
 * one rule, and a sweep tinted with the theme's own border colour.
 */
export default function Skeleton({ height = 16, width = '100%', className = '' }) {
  return (
    <div
      className={`pinex-skeleton relative overflow-hidden ${className}`}
      style={{
        height,
        width,
        background: C.surface2,
        borderRadius: 2,
      }}
    />
  )
}
