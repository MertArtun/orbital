---
paths:
  - "components/**/*.tsx"
  - "hooks/**/*.ts"
  - "app/globals.css"
  - "app/page.tsx"
---
# Visual and interaction rules

The first viewport must deliver the “wow” moment: large night globe, moving ISS, orbital trail, restrained neon, and mission-control hierarchy. Avoid generic cards, excessive gradients, and ornamental motion that competes with data.

Keep 3D rendering behind a client-only dynamic boundary. Propagation updates at 1Hz; visual transitions make motion smooth. Respect reduced motion. All buttons need accessible names and visible focus. Loading, empty, stale, and unavailable states must preserve layout. Validate at 375×812 and desktop. Do not use external image hotlinks for critical visuals.
