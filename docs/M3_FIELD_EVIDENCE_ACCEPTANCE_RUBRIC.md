# M3 field-evidence acceptance rubric (PLUS ↔ DekaMarkt)

Status: **procedure only, no field observation collected**. This checklist complements the M3 operator card and issue #78; it does not replace canonical ingestion, conversion, comparator or assessment tooling.

## Before collecting

- Choose **one region, one 24-hour price context**, and the **same demand** for both retailer baskets. Record capture times and whether delivery, loyalty, deposit, fees, or offer eligibility changes the price context.
- Use only lawful, permitted, non-intrusive observations. Do not bypass access controls or turn a manual pilot into unauthorized automated ingestion.
- Freeze the ingredient demands, units and quantities **before** inspecting which shop is cheaper. Write down substitutions, pack sizes and missing equivalents rather than silently changing demand.
- Retain only the minimum privacy-safe source context required to reproduce the calculation. Never commit personal checkout details, account identifiers or transaction receipts containing personal information.

## Acceptance matrix

| Gate | Pass criterion | Otherwise |
| --- | --- | --- |
| Provenance | Each quoted price has retailer identity, capture timestamp, product/pack identity, observed amount, currency and price context. | Mark observation **incomplete**, not savings. |
| Same demand | Both baskets trace to identical frozen ingredient requirements and accepted substitution policy. | Mark **not comparable**; record divergent lines. |
| Time alignment | Both price captures are within the same 24-hour window and clearly describe offer eligibility. | Mark **unknown**; do not extrapolate across periods. |
| Quantity and pack sizes | Units, pack counts, offered quantity and quantity conversion are explicit and inspectable. | Flag the affected line as **unknown**; never infer a pack size. |
| Basket completeness | Every required item is fulfilled, explicitly substituted, or reported missing/unknown in each store. | Do not present a misleading complete-basket total. |
| Baseline | PLUS is declared as baseline **before** the comparison; DekaMarkt is candidate. | Reject any post-hoc baseline switch. |
| Cost accounting | Totals use the canonical converter/assessment path, including applicable deposits/fees or clearly excluding them with the same rule. | Withhold net savings, preserve partial line evidence. |
| Outcome | Record **cheaper, equal, worse, or cannot decide** based on canonical assessment, with precise signed delta where supported. | Do not force a positive-saving label. |
| Attribution | Separate observed product-price difference from planning, offer and pack-size effects; unknown attribution stays unknown. | Do not advertise an unsupported source of savings. |
| Reproducibility | A second reviewer can rerun the canonical tool on the sanitized inputs and obtain the same outcome. | Keep M3 exit pending and capture a concrete reproduction defect. |

## Decision recording

Record a minimal result: observation date/time window; region; baseline/candidate names; demand/line count; accepted/rejected lines with reasons; canonical input artifact location; canonical command/tool version and output artifact; evidence reviewer; comparison outcome; and whether all gates above passed.

A **negative result is valid evidence**. A **cannot-decide result is valid diagnostic evidence** but is not proof of savings. A technically green CI run or demo fixture is not a substitute for genuine field observation.

## M3 release gate

Do **not** close [issue #78](https://github.com/Zennay/Supa/issues/78) or claim observed savings based solely on this document. Only close the field-proof gate after one genuine, independently reviewable PLUS/DekaMarkt same-demand pair has been assessed through the canonical path with its limitations preserved. If the result exposes a product defect, raise a narrowly scoped issue with sanitized reproduction data; avoid modifying concurrent workers' files.
