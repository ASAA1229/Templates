# Template Library — Batch 001

**Repository:** ASAA1229/Templates  
**Branch:** new  
**Batch status:** Added to the local template library; owner review/approval is still required before project generation.

## Scope delivered

This batch adds **25 industry-specific website demo templates**: five distinct variants for each of five initial business types.

| Sector | Business type | Templates |
|---|---|---:|
| Hospitality | Restaurant / cafe | 5 |
| Healthcare | Clinic / healthcare provider | 5 |
| Education | School / education institute | 5 |
| Retail & commerce | Retail / ecommerce store | 5 |
| Professional services | Consulting / agency / professional firm | 5 |
| **Total** | **5 business types** | **25** |

## Five variants per business type

1. **Essential** — clear, polished one-page presence.
2. **Editorial** — narrative-led brand story and proof points.
3. **Catalog** — browsable menu, programme, service or product cards with filters.
4. **Booking** — conversion-focused appointment, reservation, admissions or consultation enquiry.
5. **Multi-location** — branch, campus, outlet or service-region presentation.

## Package format

Each package is independently versioned under:

`apps/api/template-library/<template-id>/1.0.0/`

It contains:
- `manifest.json` — generator-compatible manifest and editable input definitions.
- `files/index.html` — responsive, self-contained demo with no external runtime dependency.
- `files/README.md` — setup, scope, safety and ownership instructions.

The existing local template library discovers packages from disk. The existing catalog page displays them under **Local template library**. The existing owner approval action pins a content digest and adds the template to the active catalog. No database schema change is required for this batch.

## Safety and limitations

- All sample content is fictional.
- Forms are intentionally preview-only and do not transmit or store data.
- Retail sample-bag interactions are local UI demonstrations; no checkout, payment or inventory service exists.
- Healthcare demo content is informational placeholder content, not medical advice or a clinical record system.
- Templates are internal ASAA assets and must not be externally published.
- Templates must be reviewed and approved by the owner before they can be used for project generation.

## Coverage and expansion

See `catalog/template-coverage.json` for the machine-readable division, sector and business-type coverage registry. Five is the initial demo target, **not a platform limit**. New business types, sectors, divisions and any number of additional variants can be added without changing the template-library directory contract.

## Validation status

- Package structure and manifest inputs are authored to the current generator contract.
- Runtime manifest discovery, content validation, preview/generation, frontend rendering, lint, typecheck, build and automated tests have **not yet been executed in this change session**.
- Do not mark the batch production-ready until those checks pass and the templates have been reviewed in the platform.
