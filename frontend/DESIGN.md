---
name: Overwatch
description: Dark, map-first operations software where amber marks the human decision and cyan marks everything the AI says.
colors:
  ground: "#06080b"
  panel: "#0c1015"
  raised: "#121820"
  control: "#1a222d"
  line: "#232c39"
  line-strong: "#3a4757"
  ink: "#e9edf2"
  ink-2: "#a8b2bf"
  ink-3: "#8592a2"
  amber: "#ffb224"
  amber-dim: "#7a5410"
  on-amber: "#1a1100"
  ai-cyan: "#5cd3e8"
  ai-cyan-dim: "#1d5a66"
  danger: "#ff6459"
  success: "#41d392"
typography:
  title-xl:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.45
  headline:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.45
  title:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.45
  body:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
  body-emphasis:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.45
  label:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.45
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tabular-nums slashed-zero"
  figure:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tabular-nums slashed-zero"
rounded:
  sm: "2px"
  md: "4px"
  lg: "6px"
spacing:
  tight: "4px"
  item: "8px"
  group: "12px"
  section: "24px"
  rail-width: "352px"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.on-amber}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 10px"
  button-secondary:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 10px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 10px"
  button-ghost-hover:
    backgroundColor: "{colors.raised}"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px"
  reliability-track:
    backgroundColor: "{colors.control}"
    rounded: "{rounded.sm}"
    height: "6px"
  reliability-fill:
    backgroundColor: "{colors.amber}"
    rounded: "{rounded.sm}"
---

# Design System: Overwatch

## Overview

**Creative North Star: "The Watch Floor"**

Overwatch looks like the room it serves: a dim operations centre where the map is the brightest thing and every other surface recedes. Panels sit over the map like consoles over a plot table. Nothing is decorative; each pixel is either terrain, a number, a decision, or a statement from the AI. The register is institutional (air-traffic control, dispatch), never startup.

Colour carries meaning, not mood. Amber, the only accent, belongs to the human: decisions, selection, probability. Cyan belongs to the AI and appears only on text, marks and links it produced. Everything else is a cool blue-black neutral ramp. Numbers are monospace and tabular so figures never jitter as they update. Density is high but calm: a 13px default, hairline borders, small radii, zero clutter.

Confirmed rejections: purple gradients, card-in-card nesting, decorative glassmorphism. Ghost and particle colour stays warm, never cyan, because warmth encodes probability.

**Key Characteristics:**
- Dark, map-first; the darkest surface (#06080b) is map land.
- One accent (amber); one voice colour (cyan) reserved for the AI.
- IBM Plex Sans for interface, IBM Plex Mono with tabular, slashed-zero numerals for data.
- Small institutional radii (2/4/6px), hairline borders, one shadow.
- WCAG 2.1 AA: every text and accent token measures at least 4.5:1 on #06080b.

## Colors

A cold blue-black ground with a single hot amber and a single calm cyan. Hue discipline is the system.

### Primary
- **Emergency Amber** ({colors.amber}, #ffb224): human decisions, selection, probability (reliability fill, expected-gain figure, primary button, focus ring, text selection). Contrast 11.1:1 on ground.
- **Amber Ember** (#7a5410, `amber-dim`): subdued amber for non-text marks where full amber would shout.
- **Amber Ink** (#1a1100, `on-amber`): text on amber fills.

### Secondary
- **Calm AI Cyan** (#5cd3e8): anything the AI says: parsed summaries, rationale lines, AI-sourced links. Contrast 11.4:1 on ground. Never used for probability, ghosts, particles, or decoration.
- **Cyan Dim** (#1d5a66, `ai-cyan-dim`): non-text AI marks.

### Neutral
- **Ground** (#06080b): map land, page background.
- **Panel** (#0c1015): cards and rails.
- **Raised** (#121820): popovers, ghost-button hover, raised swatches.
- **Control** (#1a222d): secondary button fill, meter track.
- **Line** (#232c39): decorative dividers and card borders.
- **Line Strong** (#3a4757): control outlines, swatch borders, scrollbar thumbs.
- **Ink** (#e9edf2): primary text (17.1:1).
- **Ink 2** (#a8b2bf): secondary text (9.3:1).
- **Ink 3** (#8592a2): metadata, timestamps, units (6.3:1).

### Status
- **Danger** (#ff6459): rejected, failed, unsafe (6.9:1).
- **Success** (#41d392): constraint met, confirmed (10.5:1).

### Named Rules
**The One Hand Rule.** Amber is the human hand. If a person chose it, selected it, or it expresses probability, it is amber; if the machine said it, it is not.

**The AI Voice Rule.** Cyan appears only on content the AI produced. Remove the AI and the cyan on screen should vanish with it.

**The Warm Probability Rule.** Ghost and particle colour stays warm, never cyan: warmth means probability.

**The Measured Ink Rule.** Text and accent colours must measure at least 4.5:1 on #06080b before they enter the palette.

## Typography

**Display Font:** none; the interface sans carries titles (IBM Plex Sans, with ui-sans-serif, system-ui, sans-serif)
**Body Font:** IBM Plex Sans (400, 500, 600)
**Label/Mono Font:** IBM Plex Mono (400, 500), tabular and slashed-zero

**Character:** Plex is engineered and institutional; Sans for language, Mono for anything measured. The pairing shares one skeleton, so data and prose sit side by side without friction.

### Hierarchy
- **Case name** (600, 1.75rem / 28px, 1.45): the case title.
- **Panel title** (600, 1.25rem / 20px, 1.45): section and panel headings.
- **Card title** (500, 1rem / 16px, 1.45): card headings.
- **Emphasis** (500, 0.875rem / 14px, 1.45): item names such as a drone, key lines.
- **Body** (400, 0.8125rem / 13px, 1.45): the default interface size; prose capped near 60ch.
- **Detail** (400-500, 0.75rem / 12px): secondary detail, card eyebrow-free labels like "Sighting".
- **Data** (Mono 400, 0.6875rem / 11px): timestamps, units, hex values, percentages.
- **Figure** (Mono 400, 1.25rem / 20px): the expected-gain number on a tasking card, in amber.

### Named Rules
**The Tabular Rule.** Every number a person reads as data (coordinates, times, percentages, minutes) is IBM Plex Mono with tabular, slashed-zero numerals, so values never jitter as they update.

**The Thirteen Rule.** Default interface text is 13px; larger sizes are for titles and the single hero figure, not for body copy.

## Layout

Map-first: the map fills the viewport and panels sit over it. A fixed side rail is 22rem (352px) wide. Spacing follows Tailwind's 4px scale with named recurring gaps: tight 4px, item 8px, group 12px, section 24px. Card padding is 12px; cards stack in a two-column grid from the md breakpoint and one column below it. Page copy lines are capped near 60ch.

The subtle grid (white at 3.5% opacity, 32px cells) is allowed only on empty canvas regions and the styleguide ground, never behind content or over the map.

### Named Rules
**The Empty Canvas Rule.** The grid appears only where there is nothing else to show.

## Elevation & Depth

Mostly flat and tonal: depth comes from the four-step surface ramp (ground to control) and hairline borders. A single shadow exists for floating panels and cards sitting over the map.

### Shadow Vocabulary
- **Panel** (`box-shadow: 0 8px 24px rgb(0 0 0 / 0.45), 0 1px 2px rgb(0 0 0 / 0.5)`): cards and floating panels over the map. Offset and blur only.

### Named Rules
**The No Halo Rule.** Depth is black offset and blur, never a coloured glow; amber and cyan do not emit light.

## Shapes

Institutional and small: chips and bars 2px, controls and cards 4px, panels and sheets 6px. Borders are 1px hairlines; the meter is a 6px-tall bar with 2px corners. No pills, no circular containers for content.

## Components

### Buttons
- **Shape:** 4px radius at the small size used in cards (28px tall, 10px horizontal padding, 0.8rem text, 500 weight).
- **Primary:** amber fill (#ffb224), amber-ink text (#1a1100); hover drops to 80% opacity. Reserved for the human approving a decision.
- **Secondary:** control fill (#1a222d), ink text; a 5% foreground mix on hover.
- **Ghost:** transparent, ink text; raised-surface fill on hover. Used for Reject-class actions.
- **Focus / Press:** 2px amber outline with 2px offset globally, plus a 3px amber/50% ring; pressed state nudges 1px down. Disabled is 50% opacity.

### Cards / Containers
- **Corner Style:** 4px.
- **Background:** panel (#0c1015) with a 1px line border (#232c39).
- **Shadow Strategy:** the single Panel shadow.
- **Internal Padding:** 12px.

### Evidence Card
Header row: 16px icon, 12px medium title, right-aligned mono timestamp in Ink 3. The AI-parsed summary is 14px cyan with a small sparkle mark; the source line beneath is 12px Ink 2. A reliability meter closes the card.

### Tasking Card
Header: drone icon, 14px medium name, mono duration. The headline figure is the expected gain in 20px Plex Mono amber with a 14px Ink 2 unit label. The AI rationale is 12px cyan. A constraint row lists 11px Ink 2 items (battery, line of sight, airspace, wind) each led by a 12px green check. Actions: Approve (primary), Edit (secondary), Reject (ghost).

### Reliability Meter
A 6px bar on the control fill with an amber fill and 2px corners, exposed with `role="meter"` and a mono 11px percentage to its right.

### Status Text
Success and danger colours apply to text and small marks only (constraint check, failure), never as fills for large surfaces.

## Do's and Don'ts

### Do:
- **Do** use amber (#ffb224) only for human decisions, selection and probability.
- **Do** use cyan (#5cd3e8) only for content the AI produced.
- **Do** set every data number in IBM Plex Mono with tabular, slashed-zero numerals.
- **Do** keep text on the measured ink tiers (#e9edf2, #a8b2bf, #8592a2) and verify 4.5:1 against the surface it sits on.
- **Do** keep radii at 2/4/6px and use one shadow.
- **Do** reference tokens from `src/styles/tokens.css`; never hard-code colours elsewhere.

### Don't:
- **Don't** use purple gradients.
- **Don't** nest a card inside a card.
- **Don't** use decorative glassmorphism.
- **Don't** colour ghosts or particles cyan; they stay warm.
- **Don't** use amber for AI content or cyan for human decisions.
- **Don't** put the grid behind content.
