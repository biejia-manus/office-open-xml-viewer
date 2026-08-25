/**
 * Retained-layout validation policy.
 *
 * The layout engine defends its "retained layout is structured-clone-safe plain
 * data" contract with two recursive traversals: `assertPlainData` (every node,
 * every property, checking prototypes, symbols, property descriptors and finite
 * numbers) and the full `assertDocumentLayoutUnchecked` invariant suite. They
 * are contract checks on ENGINE-PRODUCED data, not on untrusted input: the
 * graph they inspect is built entirely by this package, so a violation is a bug
 * in the engine rather than a property of the document being viewed.
 *
 * Running them on every finished layout — and, via `snapshotPlainData`, on every
 * block accepted during pagination — costs a large fraction of total layout time
 * on big documents, and it re-pays that cost on every convergence pass. This
 * module makes the checks a development-time contract instead of a production
 * one:
 *
 * - ON by default under a test runner, so every suite (and therefore CI) keeps
 *   validating exactly as before.
 * - ON when a document is loaded with `debug: true`.
 * - OFF otherwise, where the freezing still happens but the traversals do not.
 *
 * The trade is explicit: with validation off, an engine bug that used to surface
 * as a typed `LayoutInvariantError` at load time would instead surface as a
 * paint defect. That is acceptable precisely because the checks are exhaustive
 * in test and CI, where such a bug is introduced.
 *
 * Freezing is NOT part of this policy and always runs: retained-layout
 * immutability is load-bearing (the identity WeakSets here and in
 * `invariants.ts`, the `DeepReadonly` contract the variant store hands out, and
 * the assumption that a cached layout cannot be mutated by a consumer).
 */

/** Whether a test runner is driving this process. Vitest sets `VITEST`; the
 *  `NODE_ENV` check covers other runners and Node's own test tooling. Guarded
 *  for realms without `process` (browser bundles, workers). */
function detectTestEnvironment(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  if (!env) return false;
  return env.VITEST !== undefined || env.NODE_ENV === 'test';
}

let enabled = detectTestEnvironment();

/** Whether the recursive retained-layout contract checks should run. */
export function documentLayoutValidationEnabled(): boolean {
  return enabled;
}

/**
 * Turn the retained-layout contract checks on or off for this realm.
 *
 * Exposed as an explicit switch rather than an implicit `NODE_ENV` sniff inside
 * the layout code so an embedder can opt into full validation in production
 * while diagnosing a layout defect. `DocxDocument.load({ debug: true })` calls
 * this for the same reason.
 */
export function setDocumentLayoutValidation(next: boolean): void {
  enabled = next;
}
