# Distinguishing Receiver vs Sender Thermal Throttling

**Bead:** bf-3mnt
**Plan References:** R11, E17a, E17b, D27
**Status:** Specification (implementation pending)

## Problem Statement

The current thermal throttling proxy — "sustained fps decline > 30% from a cool start" (R11) — cannot distinguish between two different failure modes that require opposite mitigations:

| Mode | Symptom | Cause | Required Mitigation |
|------|---------|-------|---------------------|
| **Sender thermal throttling** (E17a) | Frames arrive at reduced rate | Sender's encode/render slows under thermal pressure | D18b: Sender reduces ladder intensity (local step-down) |
| **Receiver thermal throttling** (E17b) | Decode slows, fewer frames processed | Receiver's decode path slows under thermal pressure | D27: Receiver duty-cycles, drops resolution |

**Why this matters:** If the receiver misidentifies sender-side throttling as its own and duty-cycles in response, it makes the situation strictly worse — the sender is already slow, and now the receiver reads fewer frames from it.

## Evidence from Hardware

**Sender-side (E17a):** Bench laptop decayed 6.7 → 2.4 fps (-64%) over two minutes during encode/render. This is locally observable to the sender.

**Receiver-side (E17b):** Pixel 6 hit 70°C / throttling threshold within 20–30 minutes of continuous decoding. No web API exposes SoC temperature, so the receiver must infer from performance metrics.

## Discrimination Strategy

The receiver can distinguish these modes by analyzing **two independent metrics**:

### Metric 1: Camera Frame Rate

Measured via `requestVideoFrameCallback` or frame timestamps (D14). This tracks how fast the camera is delivering frames to the receiver pipeline.

### Metric 2: Decode Latency

Measured as time from frame receipt to decoded packet output. This tracks the receiver's internal decode speed.

### Decision Matrix

| Camera Frame Rate | Decode Latency | Interpretation |
|-------------------|----------------|----------------|
| **Stable** (within 10% of baseline) | **Increased** (>30% over baseline) | **Receiver thermal throttling** — The sender is still emitting at full rate, but the receiver is struggling to keep up with decoding. Apply D27: duty-cycle and/or resolution drop. |
| **Decreased** (>30% below baseline) | **Stable** (within 30% of baseline) | **Sender thermal throttling** — The sender's emission rate has dropped, but the receiver can still decode what arrives promptly. The receiver CANNOT mitigate this directly (no back-channel in v1 per D18a). Surface an informative message. |
| **Decreased** (>30% below baseline) | **Increased** (>30% over baseline) | **Both throttling** — Both ends are under thermal pressure. Apply receiver-side mitigation (D27 duty-cycle) and surface a sender-side warning. |
| **Stable** | **Stable** | No thermal throttling — Normal operation. |

## Implementation Specification

### Baseline Measurement

Establish baseline metrics during the first 60 seconds of operation (cool start):

- `baselineCameraFps`: Average camera frame rate over first 60s
- `baselineDecodeLatency`: Median decode latency (p50) over first 60s

These baselines are stored in `RecvSession.thermalBaseline`:

```ts
type RecvSession = {
  // ... existing fields ...
  thermalBaseline: {
    cameraFps: number;
    decodeLatencyMs: number;
    establishedAt: number; // timestamp
  } | null;
  currentThermalState: 'normal' | 'receiver-throttling' | 'sender-throttling' | 'both-throttling';
};
```

### Continuous Monitoring

On every camera frame (or every 1s, whichever is less frequent):

1. Measure current camera fps over last 10s sliding window
2. Measure current decode latency p50 over last 10s sliding window
3. Compare against baseline using 30% thresholds

### Threshold Logic

```typescript
function assessThermalState(current: {
  cameraFps: number;
  decodeLatencyMs: number;
}, baseline: {
  cameraFps: number;
  decodeLatencyMs: number;
}): ThermalState {
  const cameraFpsRatio = current.cameraFps / baseline.cameraFps;
  const decodeLatencyRatio = current.decodeLatencyMs / baseline.decodeLatencyMs;

  const cameraDepressed = cameraFpsRatio < 0.7; // >30% decline
  const decodeElevated = decodeLatencyRatio > 1.3; // >30% increase

  if (!cameraDepressed && decodeElevated) {
    return 'receiver-throttling';
  } else if (cameraDepressed && !decodeElevated) {
    return 'sender-throttling';
  } else if (cameraDepressed && decodeElevated) {
    return 'both-throttling';
  } else {
    return 'normal';
  }
}
```

### Response Actions

#### Receiver-Throttling Detection

Apply D27 mitigation in stages:

1. **Stage 1 (mild):** Duty-cycle at 75% (decode 3 frames, skip 1)
2. **Stage 2 (moderate):** Duty-cycle at 50% (decode 1 frame, skip 1)
3. **Stage 3 (severe):** Duty-cycle at 25% AND attempt resolution drop (if ≥4 camera px/module can be maintained)

Tell the user: "Receiver is running warm — reducing decode rate to stay cool. Transfer will take longer but will complete."

Re-assess every 30s. If state returns to 'normal' for 60s, gradually restore duty cycle.

#### Sender-Throttling Detection

The receiver **CANNOT** directly mitigate sender-side throttling (no back-channel per D18a). Instead:

1. Surface a user-visible message: "The sending device appears to be running warm and slowing down. If this persists, let it cool down or continue later — the receiver is working normally."
2. Continue normal decode operations — do NOT duty-cycle
3. If goodput drops below 1 KB/s for 60s, suggest user intervention: "Transfer has stalled. The sender may need to cool down, or you may use repair mode to complete what you have."

#### Both-Throttling Detection

Apply receiver-side mitigation (as above) AND surface sender-side warning.

## Edge Cases

### Cold Start Detection

Do not establish thermal baseline until 60s of sustained operation. This prevents false positives from:
- Camera autofocus hunting (first 2-5s)
- JIT compilation warm-up (first ~10s)
- OPFS initialization (first ~1s)

### Sudden Optical Changes

Reframing, distance changes, or lighting changes can cause transient fps drops. Use 10s sliding windows and require sustained state for 30s before triggering mitigation to prevent oscillation.

### Low-End Hardware

On very slow devices, baseline decode latency may already be elevated. The 30% threshold is relative to baseline, not absolute, so this adapts to device capability.

## Integration with Existing Components

### Receiver Pipeline (§6.4)

Add thermal monitoring between the decode pool and the GE decoder. The decode pool already tracks per-frame timing; add:

1. Frame receipt timestamp (already available via `requestVideoFrameCallback`)
2. Decode completion timestamp (already tracked for decode latency reporting)

### Error Taxonomy (§11)

Add new error codes for thermal states:

| Code | Meaning | User-facing |
|-----|---------|-------------|
| `E-RECEIVER-THERMAL` | Receiver decode slowed by thermal pressure | "Receiver is warming up — reducing rate to stay cool. Transfer will continue but take longer." |
| `E-SENDER-THERMAL` | Frame arrival rate suggests sender thermal throttling | "The sending device appears to be slowing down. Consider letting it cool — this receiver is working normally." |
| `E-BOTH-THERMAL` | Both sides showing thermal pressure | "Both devices are warming up. Reducing receiver rate; sender may need to cool down." |

These are **informational**, not terminal errors. The transfer continues.

## Testing Requirements

### T-long-run Extension

The existing thermal test (T-long-run, §14.1) must validate:

1. **Cold-start baseline establishment:** Confirm baseline is set correctly on first 60s
2. **Receiver-throttling detection:** Artificially load the receiver CPU and confirm correct state detection
3. **Sender-throttling simulation:** Reduce sender frame rate artificially and confirm correct state detection
4. **Duty-cycle effectiveness:** Confirm 50% duty cycle reduces heat accumulation while maintaining forward progress
5. **False-positive resistance:** Run optical perturbations (reframing, lighting changes) and confirm no spurious thermal state transitions

### Synthetic Tests

- Test threshold logic with synthetic data covering all matrix quadrants
- Test hysteresis (state transitions and recovery)
- Test cold-start detection with various startup durations

## Open Questions

1. **Camera frame rate vs frame arrival rate:** The camera may deliver frames at 30 fps, but if the sender is emitting at 2 fps, we'll see duplicate frames. Does `requestVideoFrameCallback` report duplicate timestamps for the same sender frame, or do we need a separate "unique frames per second" metric? This needs measurement on real hardware.

2. **Decode latency measurement granularity:** If decode happens in a worker pool (§6.2), which worker's latency do we measure? Recommendation: Use p50 across all workers to smooth out individual variance.

3. **Threshold tuning:** Are 30% thresholds appropriate, or should these be configurable or empirically derived? These are starting values for v1; T-long-run may reveal better numbers.

## References

- Plan.md §18 R11: Thermal throttling risk
- Plan.md §10 E17a: Sender-side thermal throttling
- Plan.md §10 E17b: Receiver-side thermal throttling
- Plan.md §4 D27: Receiver duty-cycling decision
- Plan.md §4 D18b: Sender local step-down
- `docs/notes/spike-results.md`: S1 (GE throughput), S2 (optical loop), Thermal section
