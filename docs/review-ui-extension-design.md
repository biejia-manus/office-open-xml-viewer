# Review UI extension design

## Status

Accepted for the read-only comment and tracked-change work. The first delivery
targets comment cards in `DocxScrollViewer`, `XlsxViewer` / `XlsxSheetViewer`,
and `PptxScrollViewer`; editing, replying, and resolving comments remain
application responsibilities.

## Goals

- provide deliberately plain cards in the DOCX/PPTX margin and XLSX cell popup;
- let applications replace card contents without replacing viewer layout,
  activation, page virtualization, or cleanup;
- support React, Vue, and other DOM frameworks without remounting component roots
  when zoom, selection, or geometry changes;
- keep OOXML records and stable logical identities separate from transient page
  geometry;
- permit connector lines and other page-relative decorations without exposing
  parser or retained-layout internals;
- remain valid when pages are published progressively and when mounted pages or
  individual cards are virtualized.

## Non-goals

- comment or revision editing;
- a general application panel framework;
- framework-specific adapters in the core packages;
- reproducing Word or PowerPoint chrome;
- combining comments and tracked changes into one artificial OOXML model.

## Ownership

The format packages own OOXML parsing and format-specific identities and
anchors. DOCX/PPTX `ScrollViewer` owns the transparent page-side margin, card
placement, selection state, page virtualization, and DOM lifecycle. XLSX owns
its cell-anchored popup and sheet visibility. The application owns custom card
contents and optional DOCX/PPTX decoration contents. Core owns only the small
DOM mount lifecycle and normalized display model shared by all three formats.

The default page-side UI belongs only to DOCX/PPTX `ScrollViewer`. Canvas-only
page viewers continue to expose parsed review data and anchor projections
without acquiring a side panel. XLSX keeps its pre-existing cell popup because
the sheet viewport itself owns cell hit testing and scrolling.

## Stable data and transient geometry

A comment thread has a viewer-stable `occurrenceKey` for the lifetime of one
loaded document or presentation. Format-specific OOXML identifiers remain
available in the format-specific mount context. An occurrence key is not a
persistent storage identifier.

Page geometry is an immutable snapshot. Each snapshot carries a monotonically
increasing geometry revision and a layout generation. Consumers must replace
their prior geometry when a newer snapshot arrives; they must not retain or
mutate viewer layout objects. Replacing a document aborts and destroys every
mount from the old generation before publishing the new generation.

This separation allows a progressive layout implementation to publish partial
pages, move an anchor to another page, or revise page count without changing the
logical comment record. A page or card may be destroyed and mounted again as
virtualization changes the visible window.

## DOM mount contract

Custom UI uses a stable synchronous mount lifecycle:

```ts
type ViewerDomMount<Context> = (
  host: HTMLElement,
  initialContext: Context,
) => {
  update(context: Context): void;
  destroy(): void;
};
```

The host and component root remain stable between `mount` and `destroy`.
`update` receives an immutable replacement context. A mount receives an
`AbortSignal`; asynchronous work must observe it. Promise-returning mounts are
rejected because asynchronous ownership would make rollback and virtualization
ambiguous.

The host is connected before mount so React and Vue can create a real root. The
viewer guarantees exactly one destroy attempt for every successful mount. If
mounting fails, it aborts the signal, rolls back registered resources, and
removes the host. Consumer code that allocates a framework root and then throws
before returning its handle must unmount that root before rethrowing, because no
handle exists for the viewer to call. Cleanup continues after an individual
cleanup error, and failures are reported through the viewer error channel.

React adapters create one root during mount, call `root.render` from `update`,
and call `root.unmount` from `destroy`. Vue adapters create one app around a
reactive context during mount, assign the new context during `update`, and
unmount during `destroy`.

## Interaction boundary

DOCX/PPTX `setActive(boolean)` is idempotent. XLSX instead exposes `dismiss()`:
hovering a cell is not misrepresented as selection. Outside-click and
pointer-leave handling use the event's composed path. Every format can register
Portal, Teleport, or Shadow DOM roots as part of its interaction boundary and
unregister them independently. Registrations are reference-counted when several
cards share one framework portal root.

## Decorations

Card replacement and page decoration are separate extension points. Decoration
is available on the DOCX/PPTX margin surface; XLSX exposes card replacement but
does not pretend that its cell popup has a page-to-margin connector surface. A
decoration mount receives a transparent composite surface plus an immutable
snapshot containing:

- a discriminated format plus `pageIndex` or `slideIndex`;
- layout generation and geometry revision; DOCX also reports progressive-layout completion;
- page bounds and composite-surface bounds in CSS pixels;
- each visible thread's occurrence key, active state, anchor rectangles, and
  measured card rectangle when available.

This is sufficient for connector lines and custom highlights while keeping DOM
elements, parser objects, and retained `DocumentLayout` nodes private. The
viewer may coalesce geometry updates to one animation frame. Decoration mounts
must treat card rectangles as temporarily unavailable while cards are mounting
or being measured.

## Visibility and virtualization

Resolved or closed comments are a visibility policy, not a parser filter. Raw
comment APIs always preserve them. DOCX/PPTX margins hide them by default. XLSX
keeps its historical behavior and shows them by default. `includeResolved`
allows either policy to be selected explicitly.

Page virtualization is the first bounded rendering layer. Stable occurrence
keys and mount/update/destroy semantics deliberately allow later card-level
virtualization without changing the public adapter contract. Component-local
state is not guaranteed to survive an unmount; applications that require that
state keep it outside the mounted card and key it by occurrence key.

No estimated text heights, comment-count thresholds, or document-specific
placement constants are part of the contract. The browser measures card hosts;
the viewer uses those measured rectangles for collision layout and decoration
snapshots.

## Tracked changes

Tracked changes remain a DOCX layout choice and a separate revision data API.
They may later use the same DOM mount primitive for a history pane, but comment
thread types, comment visibility, and card placement are not generalized into a
single review-item abstraction until a concrete shared behavior exists.

## Progressive layout compatibility

The design is compatible with the proposed progressive document layout work.
Its `onLayoutPartial` handover must invalidate comment geometry through the same
viewer relayout path as page slots; comments do not create a second pagination
subscription or independently infer page ownership:

- logical records are available independently of their current page geometry;
- geometry updates are generation- and revision-scoped;
- page count and completion are observations, not constructor invariants;
- stale callbacks from a replaced document cannot update current mounts;
- destroying a virtualized page releases cards and decorations synchronously;
- exact/inexact internal pagination details are not exposed as public UI policy.

## Acceptance tests

- a custom card root is mounted once and updated across activation and zoom;
- destroy and abort occur exactly once on page recycle, document replacement,
  and viewer destruction;
- mount failure rolls back all registered interaction roots;
- Portal/Teleport/Shadow DOM clicks do not clear selection;
- resolved-comment visibility is explicit and testable;
- duplicate source identifiers on different slides receive distinct occurrence
  keys;
- geometry revisions replace stale connector snapshots;
- simulated partial layout growth does not leak old-generation mounts;
- DOCX, XLSX, and PPTX use the shared lifecycle while retaining format-specific data.
