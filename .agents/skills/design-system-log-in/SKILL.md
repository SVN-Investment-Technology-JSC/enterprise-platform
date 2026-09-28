---
name: design-system-log-in
description: Creates implementation-ready design-system guidance with tokens, component behavior, and accessibility standards for enterprise authentication surfaces. Use when creating or updating UI rules, component specifications, or design-system documentation.
---

<!-- TYPEUI_SH_MANAGED_START -->

# Log In

## Mission
Deliver implementation-ready design-system guidance for Log In that can be applied consistently across dashboard web app interfaces.

## Brand
- Product/brand: Log In
- URL: https://zoyothemes.com/hando/html/auth-login
- Audience: authenticated users and operators
- Product surface: dashboard web app

## Style Foundations
- Visual style: structured, accessible, implementation-first
- Main font style: `font.family.primary=Public Sans`, `font.family.stack=Public Sans, sans-serif`, `font.size.base=14px`, `font.weight.base=400`, `font.lineHeight.base=21px`
- Typography scale: `font.size.xs=14px`, `font.size.sm=18px`, `font.size.md=21px`, `font.size.lg=25px`
- Color palette: `color.text.primary=#4a5a6b`, `color.text.secondary=#ffffff`, `color.text.tertiary=#060707`, `color.border.muted=#108dff`, `color.surface.base=#000000`, `color.surface.strong=#f6f8fb`
- Spacing scale: `space.1=2.72px`, `space.2=4.8px`, `space.3=7.52px`, `space.4=8px`, `space.5=9.6px`, `space.6=10.64px`, `space.7=15.2px`, `space.8=19.2px`
- Radius/shadow/motion tokens: `radius.xs=3.5px`, `radius.sm=4px`, `radius.md=5.2px` | `shadow.1=rgba(0, 0, 0, 0.04) 0px 2px 8px 0px` | `motion.duration.instant=150ms`, `motion.duration.fast=200ms`

## Accessibility
- Target: WCAG 2.2 AA
- Keyboard-first interactions required.
- Focus-visible rules required.
- Contrast constraints required.

## Writing Tone
concise, confident, implementation-focused

## Rules: Do
- Use semantic tokens, not raw hex values in component guidance.
- Every component must define required states: default, hover, focus-visible, active, disabled, loading, error.
- Responsive behavior and edge-case handling should be specified for every component family.
- Accessibility acceptance criteria must be testable in implementation.

## Rules: Don't
- Do not allow low-contrast text or hidden focus indicators.
- Do not introduce one-off spacing or typography exceptions.
- Do not use ambiguous labels or non-descriptive actions.

## Guideline Authoring Workflow
1. Restate design intent in one sentence.
2. Define foundations and tokens.
3. Define component anatomy, variants, and interactions.
4. Add accessibility acceptance criteria.
5. Add anti-patterns and migration notes.
6. End with QA checklist.

## Required Output Structure
- Context and goals
- Design tokens and foundations
- Component-level rules (anatomy, variants, states, responsive behavior)
- Accessibility requirements and testable acceptance criteria
- Content and tone standards with examples
- Anti-patterns and prohibited implementations
- QA checklist

## Component Rule Expectations
- Include keyboard, pointer, and touch behavior.
- Include spacing and typography token requirements.
- Include long-content, overflow, and empty-state handling.

## Quality Gates
- Every non-negotiable rule must use "must".
- Every recommendation should use "should".
- Every accessibility rule must be testable in implementation.
- Prefer system consistency over local visual exceptions.

<!-- TYPEUI_SH_MANAGED_END -->
