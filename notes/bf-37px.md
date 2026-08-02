# Rung Sweep Test - Execution Status (bf-37px)

## Current State

### Infrastructure ✅ Complete
- Rig server running on port 5173
- Test plan documented in `docs/notes/bf-37px-rung-sweep-test-plan.md`
- Quick start guide in `docs/notes/bf-37px-quick-start.md`
- Results collector script in `spike/rung-sweep-collector.mjs`

### Physical Test ❌ Not Executed
**Blocker**: Requires two physical devices on the same LAN with camera/display capabilities.

## What the Test Measures

The rung sweep tests optical QR decode performance across four increasing density levels:

| Rung | QR Version | Packets | Label | Expected Behavior |
|------|-----------|---------|-------|-------------------|
| R1   | v10-L     | 1       | Conservative | Should always work |
| R2   | v16-L     | 2       | Nominal | Should work in good conditions |
| R3   | v20-L     | 3       | Aggressive | May fail in poor conditions |
| R4   | v23-L     | 4       | Probe | Highest risk of failure |

## Test Protocol

### Setup
1. Two devices on same LAN (laptop → phone, or phone → phone)
2. Tripod mounting, 30 cm distance
3. ~300 lux lighting, 50%+ brightness on both devices
4. Rig server: `cd spike && npm run rig` (already running)

### For Each Rung (R1-R4)
1. Configure sender:
   - Rung: target rung
   - Module px: 4
   - Grid: 4×3
   - FPS: 12
2. Configure receiver: allow camera access
3. Run for 60 seconds
4. Record metrics from "Copy results"

### Metrics to Collect
- Unique packets received
- Erasure rate
- Camera fps
- Decode p50/p99
- Frames with zero
- Byte mismatches (MUST be 0)
- Corrupt tiles

## Kill Criterion

**PASS if**: R1 succeeds, OR R1 fails only when R3 also fails
**FAIL if**: R1 fails while R3 succeeds → ladder broken, §3.1.1 needs re-deriving

## Next Steps (Manual Execution Required)

1. Set up two devices on LAN
2. Open rig UI on both devices
3. One device picks "Sender", other picks "Receiver"
4. Run each rung test per protocol above
5. Run collector: `node spike/rung-sweep-collector.mjs`
6. Document results in `docs/notes/spike-results.md`

## Expected Outcomes

Based on the spike/README.md analysis:
- R1 (conservative): Most likely to succeed
- R2 (nominal): Should succeed in good conditions
- R3 (aggressive): May fail in poor conditions
- R4 (probe): Highest risk of failure

The test validates the ladder's core property: *a mis-guessed profile yields zero; a ladder always yields something.*

## Note on GE Throughput (R1)

Per spike/README.md, the GE throughput test (S1) shows R1 is effectively retired on desktop:
- Desktop: 3,260 MB/s at K=768
- Estimated phone: ~815 MB/s (÷4 factor)
- Stage 3 margin: 7.11×

**Caveat**: The ÷4 factor is a guess. Re-run on target phone before treating R1 as closed.

---

**Status**: Infrastructure ready, awaiting physical device access for execution.
