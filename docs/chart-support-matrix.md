# Chart support matrix

This document is the authoritative implementation backlog for DrawingML charts.
It complements the public feature summary: a chart family can be generally
available while individual authored properties remain partial.

## Status and completion criteria

| Status | Meaning |
| --- | --- |
| Supported | The parser preserves the authored property, the shared model exposes it, the shared renderer consumes it, and focused tests cover the supported boundary. |
| Partial | A documented subset is implemented. The Notes column states the exact boundary. |
| Missing | Valid authored markup is discarded or retained without a renderer. |
| Unverified | The implementation exists, but its Office compatibility boundary has not been established. |
| Not applicable | The property does not affect browser rendering or is intentionally outside the product scope. |

A row becomes **Supported** only when all of the following are present:

1. parser-to-model contract coverage in `packages/ooxml-common`;
2. shared rendering coverage in `packages/core` where the concept is common to
   DOCX, XLSX, and PPTX;
3. a focused geometry/style regression test;
4. an Office-produced fidelity comparison for behavior left application-defined
   by ECMA-376 or MS-ODRAWXML.

Specification-defined behavior does not require a compatibility heuristic.
Application-defined behavior must stay **Partial** or **Unverified** until its
observed input boundary is recorded in
[`chart-compatibility-evidence.md`](chart-compatibility-evidence.md).

## Classic chart families

| ID | Family / property | Parser | Model | Renderer | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| C-LINE-001 | `lineChart` standard, stacked, percent-stacked lines | Yes | Yes | Yes | Supported | Includes markers, smoothing, blank-cell policy, data labels, error bars, and trendlines. |
| C-LINE-002 | `lineChart/dropLines` | Yes | Yes | Partial | Partial | Direct line paint and owning line group are retained; geometry paints below its series. The current line renderer targets its bottom category axis, so an authored interior category-axis crossing remains open. |
| C-LINE-003 | `lineChart/hiLowLines` | Yes | Yes | Yes | Supported | Valid on ordinary line charts as well as stock charts. |
| C-LINE-004 | `lineChart/upDownBars` | Yes | Yes | Yes | Partial | Direct paint is supported. Empty-paint automatic white/black styling is limited to the retained legacy Style 2 observation. |
| C-LINE-005 | Multiple `lineChart` groups in one plot area | Yes | Yes | Partial | Partial | Decoration ownership is retained and consumed; other group-level line properties still require individual provenance rows. |
| C-LINE-006 | Group-level `marker` and `smooth` defaults | Partial | Partial | Partial | Partial | Group marker visibility is retained. Series-level smooth is retained; group-level smooth inheritance is not. |
| C-AREA-001 | `areaChart` standard, stacked, percent-stacked areas | Yes | Yes | Yes | Supported | Series fill, labels, axes, and stacking are shared across hosts. |
| C-AREA-002 | `areaChart/dropLines` | No | No | No | Missing | Valid in `EG_AreaChartShared`. |
| C-BAR-001 | `barChart` direction, grouping, overlap, and gap | Yes | Yes | Yes | Supported | Each bar group retains its own provenance and geometry. |
| C-BAR-002 | `barChart/serLines` | No | No | No | Missing | Series connector lines are separate from error bars and trendlines. |
| C-STOCK-001 | Stock high-low lines and up/down bars | Yes | Yes | Yes | Partial | High-low lines and up/down bars render; stock `dropLines` is missing. |
| C-SCATTER-001 | Scatter style, X/Y values, markers, and smoothing | Yes | Yes | Yes | Supported | Numeric axes and the six `scatterStyle` modes are represented. |
| C-RADAR-001 | Standard, marker, and filled radar styles | Yes | Yes | Yes | Supported | Direct series paint and marker controls are consumed. |
| C-PIE-001 | Pie/doughnut point explosion | Yes | Yes | Yes | Supported | Per-point explosion is retained. |
| C-PIE-002 | Pie/doughnut series-level explosion | Yes | Yes | Yes | Supported | `CT_PieSer/explosion` supplies the default; a point-level `dPt/explosion` overrides it. |
| C-PIE-003 | First-slice angle and doughnut hole size | Yes | Yes | Yes | Supported | Authored schema bounds are preserved. |
| C-OFPIE-001 | Pie-of-pie/bar-of-pie split, sizing, and connector geometry | Yes | Yes | Yes | Partial | Position, value, percent, and custom splits render. Automatic split selection remains application-defined. |
| C-BUBBLE-001 | Bubble size, scale, negative bubbles, and size representation | Yes | Yes | Yes | Supported | Resource-bounded and shared across hosts. |
| C-BUBBLE-002 | `bubble3D` | No | No | No | Missing | The current local corpus only exercises `false`; `true` remains unsupported. |
| C-SURFACE-001 | Surface/surface3D mesh, bands, camera, and authored band formatting | Yes | Yes | Yes | Partial | Supported camera/material boundaries are recorded in the compatibility evidence document. |
| C-3D-001 | Classic bar/column 3-D shapes and camera projection | Yes | Yes | Yes | Partial | Box, cylinder, cone, and pyramid geometry is bounded; compatibility evidence limits camera/material approximations. |
| C-3D-002 | Classic line, area, and pie 3-D projection | Yes | Yes | Yes | Partial | The authored 3-D group is retained and dispatched through the shared 3-D renderer; family-specific formatting remains under audit. |
| C-COMBO-001 | Multiple classic chart families and primary/secondary axes | Yes | Yes | Partial | Partial | Common bar/line/area/scatter/bubble combinations render. Arbitrary plot-area group order and every mixed grouping/direction boundary are not yet certified. |

## Shared axes, labels, legends, and chart-space properties

| ID | Property | Parser | Model | Renderer | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| C-AXIS-001 | Linear/date/log axes, authored bounds and units | Yes | Yes | Yes | Partial | Fractional month/year date-axis units require an Office compatibility boundary. |
| C-AXIS-002 | Category `lblAlgn` and `lblOffset` | No | No | No | Missing | Default values often mask the omission; non-default values are unsupported. |
| C-AXIS-003 | Axis crossing (`crosses`, `crossesAt`, and `crossBetween`) | Yes | Yes | Partial | Partial | Bar/column and Surface boundaries have focused coverage. Interior crossing remains inconsistent across line/area families. |
| C-LABEL-001 | Value/category/series/percent labels, separators, leader lines, and manual layout | Yes | Yes | Yes | Supported | Per-point and series-level overrides are retained. |
| C-LABEL-002 | `showLegendKey`, `showBubbleSize`, and `showDLblsOverMax` | No | No | No | Missing | These are independent label visibility controls. |
| C-LEGEND-001 | Position, text, fill, line, and manual layout | Yes | Yes | Yes | Supported | |
| C-LEGEND-002 | `legend/overlay` and per-entry delete/style | No | No | No | Missing | Explicit overlay and `legendEntry` overrides are not represented. |
| C-SPACE-001 | `roundedCorners` | No | No | No | Missing | Affects the outer chart-space shape. |
| C-SPACE-002 | `plotVisOnly` hidden-source behavior | No | No | No | Missing | Formula/cache resolution can currently mask the omission. |
| C-TABLE-001 | Plot-area data table content and borders | Yes | Yes | Partial | Partial | Bar/column layout consumes it. Shared placement for all axis-based classic families remains open. |

## Chart Style roles

The shared Chart Style parser currently resolves the following roles directly:
`axisTitle`, `categoryAxis`, `dataLabel`, `dataPoint`, `dataPointLine`,
`dataPointMarker`, `dataPointMarkerLayout`, `gridlineMajor`, `seriesLine`,
`title`, and `valueAxis`.

| ID | Role group | Status | Notes |
| --- | --- | --- | --- |
| S-STYLE-001 | The eleven roles listed above | Partial | Fill/line grammar is shared, but not every classic family consumes every effective role. |
| S-STYLE-002 | `chartArea`, `plotArea`, `legend`, `dataTable` | Missing | Automatic role inheritance is not retained systematically. |
| S-STYLE-003 | `gridlineMinor`, `tickLabels`, `seriesAxis` | Missing | Direct chart formatting may still render; linked-style fallback is missing. |
| S-STYLE-004 | `dropLine`, `hiLoLine`, `upBar`, `downBar`, `errorBar`, `leaderLine` | Missing | These roles should feed the corresponding shared geometry rather than family-local defaults. |
| S-STYLE-005 | `dataLabelCallout`, `trendlineLabel` | Missing | Text/shape style inheritance is incomplete. |
| S-STYLE-006 | `dataPoint3D`, `dataPointWireframe`, `floor`, `wall`, `plotArea3D` | Missing | Authored direct 3-D surface formatting remains authoritative where already modeled. |

## ChartEx layouts

| ID | Layout | Status | Notes |
| --- | --- | --- |
| X-LAYOUT-001 | Waterfall, histogram/Pareto, funnel | Supported | Includes bounded layout data and shared Chart Style paint. |
| X-LAYOUT-002 | Box-and-whisker | Supported | Includes mean/outlier/non-outlier roles and visibility controls. |
| X-LAYOUT-003 | Treemap and sunburst | Supported | Hierarchy depth/slot budgets apply before tree construction. |
| X-LAYOUT-004 | Region Map | Partial | Deterministic offline country geometry only; external geocoding is out of scope. |
| X-LAYOUT-005 | Unknown or future `layoutId` values | Missing | Fail closed with a placeholder; no layout is guessed from sample data. |

## Maintenance rules

- Update this matrix in the same pull request that changes support status.
- Do not mark a row Supported from a single screenshot or sample-specific
  adjustment.
- Keep self-VRT and Office-fidelity validation separate: self-VRT detects
  regressions, while Office exports adjudicate compatibility.
- Add a new row when valid authored markup is intentionally deferred. Silently
  discarding a newly discovered rendering property is not an acceptable steady
  state.
- Private workbooks and Office exports remain local. Public tests must use small,
  synthetic fixtures that isolate the relevant OOXML contract.
