# Thermal throttling discrimination specification (bf-3mnt)

**Plan references:** R11, E17a, E17b, D27

## Problem

The current proxy for thermal throttling — "sustained fps decline > 30% from a cool start" — **cannot distinguish between sender-side and receiver-side thermal throttling**. This is a critical gap because:

### Why it matters

**E17a shows sender-side throttling**: The bench laptop decayed from 6.7 → 2.4 fps (-64%) in two minutes during testing.

**If the receiver mistakes sender throttling for receiver throttling and duty-cycles**:
- The sender is already slow (emitting fewer frames)
- The receiver duty-cycling (skipping blocks) means more passes are needed
- Result: **A transfer that might have finished slowly now never finishes**

From D27's economics: Frame-granular 50% duty on 25% erasure delivers only 0.60 K against the 1.03 K needed at dwell 1.6 — the transfer never completes. Block-granular duty cycling fixes completion, but still multiplies transfer time.

### The two failure modes

| Aspect | Sender throttling (E17a) | Receiver throttling (E17b) |
|---|---|---|
| **Root cause** | Sender's SoC thermal throttles → frame generation slows | Receiver's SoC thermal throttles → decode slows |
| **Observed by** | Receiver (via camera) | Receiver (via decode metrics) |
| **Control point** | Sender side (D18b: local step-down) | Receiver side (D27: duty cycling) |
| **Mitigation** | Receiver should **NOT** duty-cycle | Receiver **should** duty-cycle per D27 |

## Solution: Multi-metric discrimination

Use **decode latency trends** as the primary discriminator, supported by camera fps stability.

### Distinguishing signatures

#### Sender-side thermal throttling

**Observable signature:**
- **Camera fps drops significantly** (sender emitting fewer frames)
- **Decode latency stays stable or improves** (receiver not working harder per frame)
- **Packets per second drops proportionally to camera fps**
- **Erasure rate stays roughly constant** (channel conditions unchanged)
- **Frames with zero tiles stays low or improves** (fewer frames, but each decodes normally)

**Why:** The sender is generating fewer frames, but the receiver's processing per frame remains unchanged. The receiver is idle more often.

**Example from E17a:**
- Initial: 6.7 fps → Final: 2.4 fps (-64%)
- Decode latency: ~67 ms → stays ~67 ms
- Packets/sec: drops in proportion to fps drop

#### Receiver-side thermal throttling

**Observable signature:**
- **Camera fps stays roughly constant** (sender still emitting at normal rate)
- **Decode latency increases significantly** (SoC thermal throttling CPU/GPU)
- **Packets per second drops** (slower decode despite constant frame rate)
- **Erasure rate may increase** (if decoder can't keep up with camera stream)
- **Frames with zero tiles increases** (decoder dropping frames to catch up)

**Why:** The receiver's CPU/GPU is throttling, so each frame takes longer to process. The camera is still delivering frames at the same rate, but the receiver falls behind.

**Example from thermal observations:**
- Initial: 67 ms decode → Final: 150+ ms decode (2×+ slower)
- Camera fps: stays ~4.5 fps
- Throughput: drops as decode latency increases

### Hybrid detection

Both may occur simultaneously. In this case:
- Both camera fps drops AND decode latency increases
- Duty-cycling may still help (reduces receiver heat), but the transfer will be slower
- The system should prioritize completing the transfer over speed

## Specification

### 1. Baseline calibration

**At session start (first 30 seconds):**
- Record initial metrics from a "cool start":
  - `baselineCameraFps`: Median camera fps
  - `baselineDecodeLatency`: Median decode latency (p50)
  - `baselinePacketsPerSec`: Packets successfully decoded per second
  - `baselineErasureRate`: Erasure rate (failed packets / total packets)

**Purpose:** Establish what "normal" looks like for this session's conditions.

### 2. Ongoing monitoring

**Every 5 seconds (rolling window):**
- Compute current medians:
  - `currentCameraFps`
  - `currentDecodeLatency`
  - `currentPacketsPerSec`
  - `currentErasureRate`

**Track degradation from baseline:**
- `cameraFpsRatio = currentCameraFps / baselineCameraFps`
- `decodeLatencyRatio = currentDecodeLatency / baselineDecodeLatency`
- `packetRateRatio = currentPacketsPerSec / baselinePacketsPerSec`

### 3. Classification logic

**After 60 seconds of sustained deviation** (to avoid transient noise):

#### Condition A: Sender-side throttling suspected

```
IF cameraFpsRatio < 0.7 AND decodeLatencyRatio < 1.3:
  // Camera fps dropped >30%, but decode latency stayed within +30%
  // This suggests the sender slowed down
  CLASSIFY as SENDER_THROTTLING
```

**Response:**
- **DO NOT duty-cycle** (D27 does not apply)
- Surface user-facing message: "Sender device appears to be slowing down. Transfer will continue at reduced rate."
- Continue at full attention; the sender is already doing what it can

#### Condition B: Receiver-side throttling suspected

```
IF decodeLatencyRatio > 1.5 AND cameraFpsRatio > 0.8:
  // Decode latency increased >50%, but camera fps stayed within -20%
  // This suggests receiver thermal throttling
  CLASSIFY as RECEIVER_THROTTLING
```

**Response:**
- **Apply D27 duty-cycling** (block-granular, as specified)
- Surface user-facing message: "Receiver getting warm — slowing down to avoid overheating."
- Monitor if duty-cycling stabilizes decode latency

#### Condition C: Hybrid throttling

```
IF cameraFpsRatio < 0.7 AND decodeLatencyRatio > 1.3:
  // Both camera fps dropped AND decode latency increased
  // Both sides are thermal throttling
  CLASSIFY as HYBRID_THROTTLING
```

**Response:**
- **Apply reduced duty-cycle** (e.g., 33% instead of 50%)
- Surface user-facing message: "Both devices are warming up. Transfer will continue slowly."
- Consider suggesting user let devices cool

#### Condition D: Insufficient data

```
IF sustained deviation < 60 seconds OR metrics within noise bands:
  CLASSIFY as NORMAL
  // No action
```

### 4. Confirmation and hysteresis

**To avoid flapping between classifications:**

- Once classified, **maintain classification for 120 seconds** before re-evaluating
- If metrics return to within 20% of baseline for 60 seconds, clear classification
- Log classification changes for debugging

**Validation:**
- If classified as RECEIVER_THROTTLING and duty-cycling applied:
  - Monitor `decodeLatencyRatio` over next 120 seconds
  - If `decodeLatencyRatio` decreases (improves), the classification was correct
  - If `decodeLatencyRatio` continues increasing, consider HYBRID_THROTTLING

## Implementation notes

### Decode latency measurement

From spike-results.md S2, decode latency is measured as:
- **p50**: Median time from camera frame capture to decoded packets
- **p99**: 99th percentile (more sensitive to thermal throttling)

**Recommendation:** Use **p99** for throttling detection, as thermal effects show up in tail latency before median.

### Camera fps measurement

From plan.md §6.4 and D14:
- **Never trust `getSettings()`** — it reports 30/60 while delivering 15
- **Measure delivered fps** via `requestVideoFrameCallback` timestamps
- Compute fps as: `1000 / medianFrameIntervalMs` over a 5-second window

### Noise tolerance

**Real-world conditions cause variance:**
- Hand shake → temporary erasure spikes
- Lighting changes → temporary decode latency spikes
- Focus hunting → temporary camera fps drops

**Specified thresholds (30%, 50%) include margin for noise.** The 60-second sustained requirement filters transient effects.

### Edge cases

**Very slow sender to start:**
- If baseline camera fps < 3 fps, detection may be unreliable
- Surface warning: "Poor signal — thermal detection disabled"

**Periods of no signal:**
- If erasure rate = 100% for >10 seconds, pause monitoring
- Resume when signal returns

## Plan updates needed

### Update D27

Add discrimination logic before applying duty-cycling:

> D27: **The receiver duty-cycles BLOCKS under receiver-side thermal pressure; multi-GB is framed as multi-session**. Measured: a Pixel 6 hit 70 °C and its throttling threshold in **20–30 minutes**, against a §1.1 objective of 27 h–4 days of *continuous* decoding. Duty-cycling must be **block-granular**, not frame-granular: the receiver knows blockIndex from the header (§7.1), so it decodes block N at full attention and skips N+1 entirely.
>
> **Throttling discrimination:** Before applying duty-cycling, the receiver MUST distinguish sender-side throttling (E17a) from receiver-side throttling (E17b) using the multi-metric approach specified in `docs/notes/bf-3mnt-thermal-throttling-discrimination.md`. Sender-side throttling is detected when camera fps drops >30% while decode latency stays within +30%; in this case, the receiver MUST NOT duty-cycle. Receiver-side throttling is detected when decode latency increases >50% while camera fps stays within -20%; in this case, D27's block-granular duty-cycling applies.

### Update E17a and E17b

**E17a — Sender-side thermal throttling**
- Current: "Observed: the bench laptop decayed 6.7 → 2.4 fps over two minutes. Locally observable, so D18b's local step-down applies."
- Add: "Receiver-side detection: Camera fps drops >30% while decode latency stays within +30%. See `docs/notes/bf-3mnt-thermal-throttling-discrimination.md` for discrimination logic. The receiver MUST NOT duty-cycle in response to sender-side throttling."

**E17b — Receiver-side thermal throttling**
- Current: "Observed at 70 °C / throttling threshold within 20–30 minutes... Mitigate locally instead: duty-cycle (D27) is the primary lever..."
- Add: "Detection: Decode latency increases >50% while camera fps stays within -20%. See `docs/notes/bf-3mnt-thermal-throttling-discrimination.md` for discrimination logic against sender-side throttling."

### Update R11

**R11 — Thermal throttling makes long transfers self-defeating**
- Current: "Mitigation: Duty-cycling (D27), decode-resolution drop, resume (D22). Trigger: sustained fps decline > 30% from a cool start..."
- Update to: "Trigger: Discriminate sender-side (camera fps drops, decode latency stable) vs receiver-side (decode latency increases, camera fps stable) throttling per `docs/notes/bf-3mnt-thermal-throttling-discrimination.md`. Apply D27 duty-cycling only for receiver-side throttling. Sender-side throttling should NOT trigger receiver duty-cycling."

## Testing requirements

### Unit tests

1. **Classification logic tests:**
   - Given metrics pattern for sender throttling → classify as SENDER_THROTTLING
   - Given metrics pattern for receiver throttling → classify as RECEIVER_THROTTLING
   - Given metrics pattern for hybrid → classify as HYBRID_THROTTLING
   - Given noisy but normal metrics → classify as NORMAL

2. **Hysteresis tests:**
   - Assert classification persists for 120 seconds
   - Assert classification clears after 60 seconds of normal metrics

3. **Edge case tests:**
   - Very slow sender baseline (< 3 fps)
   - Periods of no signal (100% erasure)
   - Flapping between conditions

### Integration tests

1. **Simulated sender throttling:**
   - Use test rig to slow sender frame generation
   - Verify receiver detects as SENDER_THROTTLING
   - Verify duty-cycling is NOT applied

2. **Simulated receiver throttling:**
   - Use test rig to add decode load (slower decode)
   - Verify receiver detects as RECEIVER_THROTTLING
   - Verify duty-cycling IS applied

3. **Long-run thermal profile (T-long-run):**
   - Real device over 20–30 minutes
   - Validate classification matches physical thermal state
   - Measure effectiveness of duty-cycling

## Success criteria

The specification is successful when:

1. ✓ Sender-side throttling (E17a) does NOT trigger receiver duty-cycling
2. ✓ Receiver-side throttling (E17b) DOES trigger duty-cycling per D27
3. ✓ Classification stabilizes within 60–120 seconds of throttling onset
4. ✓ False positive rate < 10% under noisy but normal conditions
5. ✓ Transfer completes where frame-granular duty-cycling would not finish

## Status

- [x] Problem analysis completed
- [x] Discrimination logic specified
- [x] Plan updates identified
- [ ] Implementation in receiver pipeline
- [ ] Unit tests written
- [ ] Integration tests validated
- [ ] Long-run thermal profile validation (T-long-run)
- [ ] Plan.md updated (D27, E17a, E17b, R11)

---

**Bead:** bf-3mnt
**Date:** 2026-08-02
**Related:** D27, R11, E17a, E17b, `spike-results.md` §Thermal
