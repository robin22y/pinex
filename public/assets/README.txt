Static image assets served from /assets/* at the web root.

Files expected here:
  arshid.png   — referenced by src/pages/BreadthLab.jsx
                 (memorial strip · "In memory of Arshid · Kerala · 2026")

Drop arshid.png into this folder. Recommended:
  - Square crop (the strip masks it to a 40 × 40 circle)
  - "objectPosition: center top" is set in the component, so a
    portrait-style crop with the face high in the frame works best
  - PNG or WebP; keep file size under ~200 KB
