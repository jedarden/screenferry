# Specify how receiver and sender thermal throttling are told apart (bf-3mnt)

## Task completed

Specified how receiver and sender thermal throttling are distinguished, addressing the gap in the current thermal throttling detection.

## Problem addressed

The existing proxy for thermal throttling — "sustained fps decline > 30% from a cool start" — could not distinguish between:

1. **Sender-side thermal throttling** (E17a): Sender's SoC slows down, emitting fewer frames
2. **Receiver-side thermal throttling** (E17b): Receiver's SoC slows down, unable to decode fast enough

This was a critical gap because if the receiver mistakes sender throttling for receiver throttling and applies duty-cycling, it makes the transfer worse — the sender is already slow, and duty-cycling means more passes are needed.

## Solution

Specified a **multi-metric discrimination approach** using:

- **Baseline calibration** at session start (first 30 seconds)
- **Ongoing monitoring** every 5 seconds (camera fps, decode latency, packets/sec)
- **Classification logic** after 60 seconds of sustained deviation:
  - **Sender throttling**: Camera fps drops >30%, decode latency stays within +30%
  - **Receiver throttling**: Decode latency increases >50%, camera fps stays within -20%
  - **Hybrid**: Both metrics show degradation
- **Response discrimination**:
  - Sender throttling → DO NOT duty-cycle (continue at full attention)
  - Receiver throttling → Apply D27 block-granular duty-cycling
  - Hybrid → Apply reduced duty-cycle

## Files created

1. **`docs/notes/bf-3mnt-thermal-throttling-discrimination.md`**
   - Complete specification with distinguishing signatures
   - Implementation notes (baseline calibration, ongoing monitoring, classification)
   - Testing requirements (unit tests, integration tests, long-run validation)
   - Success criteria

## Files updated

1. **`docs/plan/plan.md`**
   - **D27**: Added discrimination logic before applying duty-cycling
   - **E17a**: Added receiver-side detection specification, MUST NOT duty-cycle
   - **E17b**: Added detection specification using decode latency vs camera fps
   - **R11**: Updated trigger to use discrimination logic

## Key insights

1. **Decode latency is the key discriminator**: It stays stable during sender throttling but increases during receiver throttling
2. **Camera fps alone is insufficient**: It drops in both cases, but for different reasons
3. **Hysteresis prevents flapping**: Maintain classification for 120 seconds before re-evaluating
4. **Baseline calibration is essential**: Need to know what "normal" looks like for the session

## Next steps

- [ ] Implementation in receiver pipeline (future Phase)
- [ ] Unit tests for classification logic
- [ ] Integration tests with simulated throttling
- [ ] Long-run thermal profile validation (T-long-run)

---

**Bead:** bf-3mnt
**Date:** 2026-08-02
**Status:** Completed
**Related:** D27, R11, E17a, E17b
