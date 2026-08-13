# Visual direction

## Intent

The product should feel like a quiet orbital operations room, not a generic SaaS admin template. The globe is the hero; panels support it rather than competing for attention.

## Palette and material

- base: `#030014` and near-black navy
- primary telemetry: cyan, used sparingly for live/selected state
- secondary trajectory/action: violet
- warning/stale: muted amber
- panels: translucent navy, thin cool border, soft blur, low internal highlight

## Motion hierarchy

1. one-time slow camera approach
2. continuous but subtle ISS marker interpolation
3. future-track dash movement and pulse ring
4. countdown/clock updates without layout shift
5. panel hover/focus micro-motion

Reduced-motion mode removes decorative loops and shortens camera transitions while preserving state changes.

## Responsive hierarchy

Desktop: globe left/centre and mission panels right. Mobile: globe first, telemetry, passes, launches. The 375 px first viewport should still show the brand, live state and meaningful globe area. Labels and controls must not overlap the top/bottom HUD.
