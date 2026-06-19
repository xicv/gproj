# Design: code-grounded resource enrichment

## Problem

`resources enrich` and `resources organise` never read the source tree. As a
result, `owns` and `schemaSource` were planner guesses rather than verified
doc-to-code links. The audit baseline showed weak coverage: roughly 17% of
cards had `owns`, and roughly 1.6% had `schemaSource`.

## Approach

Add a deterministic code index pass that scans source files and records exported
symbols plus HTTP endpoint strings/calls. Grounding then searches each resource
card's title, excerpt, and body for exact symbol and endpoint path mentions.
Matches are merged into `owns.symbols`, `owns.endpoints`, and `schemaSource`
as `path:Symbol` refs from the code index.

This path is deterministic: no planner, no network, no inferred ownership. It
only adds refs backed by code that was actually scanned.

## Commands

`gproj resources ground [--code-root <path>]` builds the code index and applies
verified grounding to all resource cards. If `--code-root` is omitted, it uses
`<cwd>/src` when present, otherwise `<cwd>`.

`gproj resources enrich --code-root <path>` builds the same index once, runs the
planner enrichment as before, then merges deterministic grounding into each
selected card. This keeps enrichment code-aware while preserving the planner's
role for tags, intent, and resource links.

## Measurement

`gproj resources audit` already reports `owns` and `schemaSource` coverage. Run
it before and after `resources ground` or `resources enrich --code-root` to
measure the coverage jump from verified code refs.
