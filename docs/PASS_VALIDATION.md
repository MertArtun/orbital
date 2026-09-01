# Manual pass validation record

`docs/PRODUCT_SPEC.md` requires "manual comparison of at least one or two passes
against an external trusted predictor" before Phase 1 is done, and
`docs/TEST_STRATEGY.md` adds: "Do not mark the Definition of Done item complete
until real observations are entered."

**Status: NOT COMPLETE.** The ORBITAL column below is real, reproducible output.
The reference column is deliberately empty. Filling it requires a human to read
an independent predictor; inventing those values would defeat the entire point
of the exercise.

## Inputs

| Field | Value |
|---|---|
| Satellite | ISS (ZARYA), NORAD 25544 |
| TLE source | CelesTrak GP, `gp.php?CATNR=25544&FORMAT=TLE` |
| TLE epoch | `26244.17592806` → 2026-09-01T04:13:20Z |
| TLE line 1 | `1 25544U 98067A   26244.17592806  .00004207  00000+0  84620-4 0  9992` |
| TLE line 2 | `2 25544  51.6312 283.9914 0005054  95.2836 264.8730 15.48956502583532` |
| Observer | Istanbul — 41.0082° N, 28.9784° E, 40 m |
| Observer time zone | UTC+03:00 (Türkiye, no DST) |
| Prediction generated | 2026-09-01T13:58:51.964Z |
| Scan window | 72 h |
| Time step | 5 s |
| Gates | max elevation ≥ 10°, observer Sun altitude ≤ −6°, satellite sunlit |

Result over the window: **20 passes above the horizon, 5 of them visible.**

## Reproducing this record

```bash
curl -s "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE" -o iss.tle
```

Then call `predictPasses(record, { lat: 41.0082, lng: 28.9784, altitudeKm: 0.04 },
{ hours: 72, stepSeconds: 5 })` from `lib/passes.ts`.

A TLE has a limited useful life, so re-running this later against a newer element
set will legitimately produce different passes. The comparison is only meaningful
when ORBITAL and the reference predictor are driven by the **same epoch** and the
prediction is made for the same instant.

## Candidate 1 — 2026-09-02, peak 41.0°

| Event | ORBITAL (UTC) | ORBITAL (local) | Azimuth | Reference (UTC) | Δ |
|---|---|---|---|---|---|
| Rise | 02:18:51 | 05:18:51 | 309.3° NW | _to be entered_ | |
| Peak | 02:24:11 | 05:24:11 | 30.9°, el 41.0° | _to be entered_ | |
| Set | 02:29:26 | 05:29:26 | 109.5° E | _to be entered_ | |

Visible window 02:19:51 → 02:29:26 UTC (575 s of a 635 s pass).
Observer dark at peak: yes. Satellite sunlit at peak: yes.

## Candidate 2 — 2026-09-04, peak 73.0°

| Event | ORBITAL (UTC) | ORBITAL (local) | Azimuth | Reference (UTC) | Δ |
|---|---|---|---|---|---|
| Rise | 02:20:46 | 05:20:46 | 304.3° NW | _to be entered_ | |
| Peak | 02:26:11 | 05:26:11 | 215.0°, el 73.0° | _to be entered_ | |
| Set | 02:31:31 | 05:31:31 | 131.9° SE | _to be entered_ | |

Visible window 02:23:11 → 02:31:31 UTC (500 s of a 645 s pass).
Observer dark at peak: yes. Satellite sunlit at peak: yes.

## Tolerance to apply when the reference values are entered

| Quantity | Expected agreement | Why |
|---|---|---|
| Rise/set time | ±30 s | 5 s sampling plus differing horizon and refraction models |
| Peak time | ±15 s | Peak is a broad extremum; sampling error dominates |
| Peak elevation | ±2° | Refraction handling and observer-altitude modelling differ |
| Azimuth | ±5° | Magnified near the zenith, where azimuth changes fastest |

Anything outside these bands is a defect to investigate, not a tolerance to widen.

## A detail worth checking against the reference

Two of the five visible passes in this window report `sunlitAtPeak: false` while
still counting as visible, and one of them reports a *visible* maximum elevation
(18.9°) lower than its geometric maximum (21.7°). That is intended: visibility is
evaluated over the samples where the satellite is illuminated and the observer is
dark, not at the peak instant, so a pass that crosses the terminator is visible
for only part of its arc. These are pre-dawn passes, where the ISS climbs into
sunlight partway through — so the illuminated portion falling *after* the peak is
the physically expected direction.

If an external predictor disagrees about **which** portion of such a pass is
visible, that is exactly the kind of discrepancy this record exists to catch.

## How to complete this record

1. Open an independent predictor (Heavens-Above, or another trusted source) for
   41.0082° N, 28.9784° E.
2. Confirm it is using an element set with the same epoch as above.
3. Enter its rise/peak/set values and compute Δ per row.
4. Record the predictor name, its element-set epoch, and the date read.
5. Only then tick the Definition of Done item in `docs/PHASE_1_DOD.md`.
