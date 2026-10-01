---
name: Liquid Serene Engineering
colors:
  surface: '#131315'
  surface-dim: '#131315'
  surface-bright: '#39393b'
  surface-container-lowest: '#0e0e10'
  surface-container-low: '#1c1b1d'
  surface-container: '#201f22'
  surface-container-high: '#2a2a2c'
  surface-container-highest: '#353437'
  on-surface: '#e5e1e4'
  on-surface-variant: '#c4c7c8'
  inverse-surface: '#e5e1e4'
  inverse-on-surface: '#313032'
  outline: '#8e9192'
  outline-variant: '#444748'
  surface-tint: '#c6c6c7'
  primary: '#ffffff'
  on-primary: '#2f3131'
  primary-container: '#e2e2e2'
  on-primary-container: '#636565'
  inverse-primary: '#5d5f5f'
  secondary: '#c6c6cf'
  on-secondary: '#2f3037'
  secondary-container: '#45464e'
  on-secondary-container: '#b4b4bd'
  tertiary: '#ffffff'
  on-tertiary: '#2f3131'
  tertiary-container: '#e2e2e2'
  on-tertiary-container: '#636565'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c7'
  on-primary-fixed: '#1a1c1c'
  on-primary-fixed-variant: '#454747'
  secondary-fixed: '#e2e1eb'
  secondary-fixed-dim: '#c6c6cf'
  on-secondary-fixed: '#1a1b22'
  on-secondary-fixed-variant: '#45464e'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c7'
  on-tertiary-fixed: '#1a1c1c'
  on-tertiary-fixed-variant: '#454747'
  background: '#131315'
  on-background: '#e5e1e4'
  surface-variant: '#353437'
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
    letterSpacing: -0.04em
  display-lg-mobile:
    fontFamily: Geist
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Geist
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.03em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 26px
    letterSpacing: -0.02em
  title-sm:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  body-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
  code-metric:
    fontFamily: JetBrains Mono
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: -0.03em
  code-metric-sm:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: -0.02em
  label-data:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0.04em
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 12px
    letterSpacing: 0.08em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-lg: 1.5rem
  margin: 1.5rem
  margin-mobile: 1rem
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
  space-2xl: 2rem
  space-3xl: 3rem
---

## Brand & Style

This design system embodies a silent, hyper-focused engineering instrument engineered for automated talent discovery and career-matching agents. It discards visual noise and generic corporate decorative artifice in favor of clinical precision, structural integrity, and computational authority.

The aesthetic marries pure minimalist dark-mode principles with tactile HUD-grade ergonomics: hairline borders, pitch-black canvases, muted silver-zinc structural boundaries, and pure optical-white signals. The emotional resonance is deterministic, calm, uncompromisingly credible, and effortless—evoking the serene focus of a mission-critical terminal.

Core identity tenets:
- **Zero Decorative Waste:** Every element, divider, and token conveys functional data or structural hierarchy.
- **Instrument Precision:** Monochromatic luminosity levels denote verification depth, parse confidence, and algorithmic delta without relying on chromatic distraction.
- **Architectural Serenity:** Translucent glass surface overlays soften optical fatigue while preserving deep-space contrast ratios.

## Colors

The color architecture is built exclusively on an absolute achromatic spectrum calibrated for dynamic contrast, optical calm, and information density.

### Surface Tiers & Canvases
- **Void Background (`#000000` / `#09090b`):** The foundational infinite canvas. Used for terminal panels, root viewports, and deep recessed containers.
- **Elevated Canvas (`#121215`):** Secondary container surface providing subtle contrast against the root void.
- **Translucent Glass Surface (`rgba(255, 255, 255, 0.03)` / backdrop blur `16px`):** Used for overlays, floating floating toolbars, and contextual audit cards.
- **Active Interactive Surface (`rgba(255, 255, 255, 0.07)`):** Hover states and selected segment backgrounds.

### Structural Hairlines
- **Subtle Perimeter Border (`rgba(255, 255, 255, 0.08)`):** Default 1px boundary for cards, data blocks, and segmented inputs.
- **Muted Structural Border (`#27272a`):** Explicit dividing lines, table rows, and grid boundaries.
- **Focused / Verified Stroke (`#ffffff`):** Active selection rings, parsed token locks, and maximum-confidence data indicators.

### Monochromatic Text & Data Hierarchy
- **Pure White (`#ffffff`):** Metric values, primary headlines, active entity titles, and enhanced match scores.
- **Zinc Light (`#e4e4e7`):** Primary body text and verified skill tags.
- **Zinc Cool Gray (`#a1a1aa`):** Secondary meta information, base score labels, parse timestamps, and input placeholding.
- **Zinc Deep Gray (`#71717a`):** Hairline labels, non-verified evidence trails, and disabled triggers.
- **Ghost Carbon (`#3f3f46`):** Inactive track pips, unfilled proficiency nodes, and empty delta meters.

## Typography

The typographic hierarchy implements an engineering-led split: **Geist** provides modern geometric neutrality for cognitive parsing across headlines and synthesis narratives, while **JetBrains Mono** delivers terminal-grade spatial alignment for metrics, extraction proofs, proficiency scores, and data schemas.

### Implementation Rules
- **Monospace Encodings:** Any number, delta percentage, capability matrix, date stamp, or verification status hash must strictly render in `JetBrains Mono`.
- **Negative Letter Spacing:** Geist headlines utilize tighter tracking (`-0.02em` to `-0.04em`) to maintain sharp typographic mass against deep dark backgrounds.
- **Label Capitalization:** System metadata indicators (`label-caps`) are styled strictly in uppercase with wide tracking (`0.08em`) to guarantee quick recognition at small scales.
- **Tabular Numerals:** All quantitative elements must specify `font-variant-numeric: tabular-nums` to ensure gap analyses and score comparisons never trigger horizontal layout shift during dynamic agent re-calculation.

## Layout & Spacing

The layout is disciplined by a modular 4px/8px incremental rhythm organized across a high-density, multi-pane workbench layout.

### Grid & Density Rules
- **Desktop Grid:** 12-column adaptive fluid grid with a 1440px target maximum viewport. Column gutters sit at `1.5rem` (`gutter-lg`) for major semantic divisions and collapse to `1rem` (`gutter`) for data inspector splits.
- **Panels & Splits:** Workspaces deploy an asymmetric tri-pane division:
  - Left Pane (Resume Source & Extraction Log): 28% width or 360px minimum.
  - Center Pane (Capabilities, Verification Engine & Scores): 44% width.
  - Right Pane (Gap Analysis & Targeted Career Action Path): 28% width.
- **Mobile / Tablet Reflow:** Below `1024px`, the tri-pane structure stacks into a unified sequence driven by segmented tabs, compressing root canvas margins to `1rem` (`margin-mobile`).
- **Internal Density:** Use `space-xs` (4px) and `space-sm` (8px) for micro-clustering (e.g., proficiency pips against skill names). Use `space-lg` (16px) for standard component interior padding.

## Elevation & Depth

In a pure monochrome dark instrument, depth is rendered through luminance layers, surface translucency, and hairline perimeter borders rather than standard blurred shadows.

### The Atmospheric Hierarchy
1. **Root Bed (`#000000`):** Inset views, unselected states, and background terminals.
2. **Layer 1 Surface (`#09090b` with border `1px solid #27272a`):** Static cards, base containers, and inactive dashboard zones.
3. **Layer 2 Interactive / Glass Surface (`rgba(255, 255, 255, 0.025)` over `#0e0e11`, backdrop filter `blur(12px)`):** Active capability nodes, parsed resume snippets, and hovered interactive rows. Border is accented with `rgba(255, 255, 255, 0.1)`.
4. **Layer 3 Floating Inspector / Dialogs (`#121215` with `1px solid rgba(255, 255, 255, 0.16)`):** Floating inspection tooltips, parsed evidence overlays, and contextual career-matching overrides.
5. **Specular Illumination:** Modals and focus rings leverage a monochromatic directional specular glow: `box-shadow: 0 0 0 1px #ffffff, 0 8px 24px -4px rgba(255, 255, 255, 0.06)`.

## Shapes

This design system uses a strict **Soft** (`1`) geometric radius scheme. Surfaces prioritize straight edges and controlled micro-radii to maintain an engineered, hardware-console impression.

### Corner Radius Standards
- **Micro Tokens (`0.125rem` / 2px):** Verification tags, proficiency level pips, and hairline status markers.
- **Standard UI Elements (`0.25rem` / 4px):** Buttons, segmented input fields, resume parsed blocks, and skill chips.
- **Card Containers (`0.5rem` / 8px - `rounded-lg`):** Main module enclosures, inspection drawers, and career trajectory graphs.
- **Modal Viewports (`0.75rem` / 12px - `rounded-xl`):** Primary agent configuration modals and deep-dive gap analysis sheets.
- **Circle (`9999px`):** Reserved solely for score radial indicators and active agent pulsating status lights.

## Components

### Buttons & Interactive Triggers
- **Primary Execution:** Solid pure white (`#ffffff`) fill with pure black (`#000000`) text, weight 500, radius `4px`. Subtle white specular glow on hover (`box-shadow: 0 0 12px rgba(255, 255, 255, 0.25)`).
- **Secondary / Ghost Outline:** Transparent fill, `1px solid rgba(255, 255, 255, 0.12)`, text `#e4e4e7`. On hover: surface tints to `rgba(255, 255, 255, 0.05)` and border transitions to `#ffffff`.
- **Destructive / Reset:** Hairline border `rgba(255, 255, 255, 0.08)`, text `#71717a`. Hover elevates text to `#ffffff` with subtle underline.

### Skill Tags & Proficiency Markers
- **Skill Capsule:** Container background `rgba(255, 255, 255, 0.03)`, border `1px solid rgba(255, 255, 255, 0.08)`. Layout pairs the skill title (`body-sm`) with a 3-pip proficiency matrix.
- **Proficiency Level Meter (1-3):** Three horizontal bars (`10px x 2px`).
  - Level 1 (Foundational): First bar `#ffffff`, subsequent bars `#27272a`.
  - Level 2 (Intermediate): First two bars `#ffffff`, third bar `#27272a`.
  - Level 3 (Advanced/Mastery): All three bars filled with `#ffffff` and subtle luminance glow.
- **Evidence Verification Indicator:** An inline monospace marker appended to the tag:
  - Verified: `[V]` rendered in `#ffffff` with an interactive link to extracted resume source lines.
  - Inferred: `[~]` rendered in `#71717a` denoting agent heuristic derivation.

### Score Metrics (Base vs. Enhanced)
- **Side-by-Side Comparator:** Dual-column data module.
  - Base Score: Rendered with subdued monospace numerals in `#71717a` over an unfilled gray track.
  - Enhanced Score (Post-Agent Optimization): Rendered in pure `#ffffff` `code-metric` accompanied by a micro delta chip (`+18.4%` in `code-metric-sm` inside a `1px solid #ffffff` pill).
- **Trajectory Delta Bar:** Hairline horizontal progress track (`2px` thickness) in `#27272a`. Base score is marked with a static `#71717a` tick; enhanced delta fills up to the new value in `#ffffff`.

### Gap Analysis & Career Growth Action Paths
- **Gap Matrix Node:** Structured table row containing:
  - Capability Deficit: Primary title (`title-sm`), target benchmark level vs. current extracted level.
  - Urgency Vector: Monospace tag indicating algorithmic priority (`CRITICAL`, `SECONDARY`, `OPTIONAL`).
- **Growth Action Path:** Step-card chain linked by a vertical 1px hairline `#27272a`. Each card displays step index in monospace (`01`, `02`), an actionable objective (e.g., *"Deploy distributed pub/sub pipeline to demonstrate architectural mastery"*), and an estimated match delta contribution (`+4.2 PTS`).

### Input Fields & Search Bars
- **Terminal Inputs:** Background `#000000`, inset border `1px solid #27272a`, font `Geist` or `JetBrains Mono` depending on context. Focus state transitions border to pure `#ffffff` with zero blur radius. Placeholder text in `#71717a`.

### Checkboxes & Segmented Selectors
- **Hairline Checkbox:** `14px x 14px` square with `2px` radius. Border `1px solid #71717a`. Checked state triggers `#ffffff` background with `#000000` razor-thin geometric checkmark.
- **Monochrome Segmented Switcher:** Container background `#000000` with `1px solid #27272a` perimeter. Selected tab is `#18181b` with pure white label text and an inset `1px` border of `rgba(255, 255, 255, 0.16)`.
