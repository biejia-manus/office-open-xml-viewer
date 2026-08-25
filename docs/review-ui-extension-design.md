# Review UI extension design

## Status

This is the boundary for the read-only comment UI. Editing, replying, resolving,
and application-specific review workflows remain application responsibilities.

## Two integration levels

### Built-in UI

`DocxScrollViewer` and `PptxScrollViewer` can show a page-side comment margin.
`XlsxViewer` and `XlsxSheetViewer` can show cell-anchored comment popups. These
Viewers own placement, zoom updates, page or sheet lifecycle, and cleanup.

The built-in structure is intentionally fixed. Applications theme it through
documented CSS custom properties inherited from the Viewer container. Internal
`data-ooxml-comment-*` attributes support Viewer behavior and tests; they are
not a public styling or DOM-structure contract. There is no component-mount
callback or framework-specific adapter.

This keeps the common path small and makes it usable from plain TypeScript,
React, Vue, and other frameworks without giving the Viewer ownership of an
application component tree.

### Application-owned UI

Applications that need different structure or behavior build their UI from the
format APIs:

- comment records and replies;
- logical anchors;
- rendered text-run geometry for DOCX;
- slide coordinates for PPTX;
- cell references and `getCellViewportRect()` for XLSX.

The application then owns its DOM or framework components, interaction model,
virtualization, and cleanup. The Viewer does not expose an intermediate card
renderer abstraction: such an abstraction would still constrain component
ownership and would duplicate framework lifecycle rules.

## Shared policy and format boundaries

All formats use `commentUi.includeResolved` as the visibility option. DOCX and
PPTX hide resolved or closed threads by default. XLSX preserves its historical
behavior and includes resolved threads by default.

The formats deliberately do not pretend their geometry is identical:

- DOCX comments attach to logical text ranges that are resolved against one
  rendered page's text runs;
- PPTX comments attach to slide coordinates;
- XLSX comments attach to cells and use a hover or touch popup.

Core owns the small built-in card style vocabulary. Each format owns projection
from its OOXML model into its UI geometry.

## Progressive loading and virtualization

The built-in UI follows the Viewer's mounted page, slide, or sheet lifecycle.
When progressive DOCX layout publishes or revises visible pages, comment
projection must be refreshed through the same relayout path; it must not infer
pagination independently.

Page and slide virtualization remain the first bounded layer. A future need for
card-level virtualization should be implemented inside the built-in margin,
without changing the public `commentUi` option. Application-owned UIs choose
their own list virtualization strategy from the primitive data APIs.

No public identity or geometry type is introduced solely to predict a future
virtualization implementation.

## Non-goals

- comment or revision editing;
- Word, Excel, or PowerPoint chrome reproduction;
- a general application panel framework;
- React, Vue, or other framework adapters;
- arbitrary DOM replacement inside the built-in UI;
- combining comments and tracked changes into one artificial OOXML model.

## Acceptance checks

- the default UI works without callbacks;
- CSS custom properties theme cards, highlights, markers, and connectors;
- DOCX/PPTX cards and geometry follow zoom and virtualized surface lifecycle;
- XLSX popup data and visible markers use the same resolved-thread policy;
- outside interaction clears the active DOCX/PPTX card;
- primitive comment and anchor APIs remain sufficient for a completely
  application-owned UI;
- public API declarations contain no framework mount lifecycle.
