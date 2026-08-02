# Rung Sweep Test Plan (bf-37px)

## Objective
Test whether the conservative rung (R1) decodes where the aggressive rung (R3) fails.

**Kill criterion**: If R1 fails while R3 works, §3.1.1's ladder needs re-deriving, and L may need to drop again.

## Background
From plan.md §3.1.1, the rung ladder is defined by packet count:

| Rung | Packets | QR version | Label |
|---|---|---|---|
| R1 | 1 | v10-L | conservative |
| R2 | 2 | v16-L | nominal |
| R3 | 3 | v20-L | aggressive |
| R4 | 4 | v23-L | probe |

The ladder's critical property: *a mis-guessed profile yields zero; a ladder always yields something.*

## Test Protocol

### Setup Requirements
1. **Two devices** on the same LAN (e.g., laptop → phone, or phone → phone)
2. **Reference setup** per §13.2:
   - Tripod mounting
   - 30 cm distance
   - ~300 lux lighting
   - Both devices at 50%+ brightness
3. **Optical rig running**: `cd spike && npm run rig`

### Test Procedure

For each rung (R1, R2, R3, R4):

1. **Configure sender**:
   - Set rung dropdown to target rung
   - Module px: 4 (fixed across all tests)
   - Grid: 4×3 (12 tiles total)
   - FPS: 12 (D9-compliant: ≤ half measured camera fps)

2. **Configure receiver**:
   - Select "Receiver" mode
   - Allow camera access
   - Verify capture resolution

3. **Run test**:
   - Press "Start" on receiver first
   - Press "Start" on sender
   - Run for **60 seconds**
   - Press "Copy results" and save

4. **Record**:
   - Unique packets received
   - Erasure rate
   - Camera fps
   - Decode p50/p99
   - Frames with zero
   - Byte mismatches (MUST be 0)
   - Corrupt tiles

### Expected Results

Per the spike README:
- **R1 (conservative)**: Most likely to succeed, lowest density
- **R2 (nominal)**: Should succeed in good conditions
- **R3 (aggressive)**: May fail in poor conditions
- **R4 (probe)**: Highest risk of failure

### Kill Criterion Analysis

| Scenario | Interpretation | Action |
|---|---|---|
| R1 succeeds, R3 fails | ✅ Ladder working as designed | No change needed |
| R1 fails, R3 succeeds | ❌ **Ladder broken** | Re-derive §3.1.1 rung table |
| All rungs succeed | ✅ Good conditions | Test under worse conditions |
| All rungs fail | ⚠️ Channel too degraded | Fix setup (distance, lighting) |

### Success Criteria

The test **passes** if:
- R1 succeeds (erasure < 50%, non-zero goodput)
- OR R1 fails ONLY when R3 also fails (conservative ≤ aggressive)
- Byte mismatches = 0 in all runs

The test **fails** (trips kill criterion) if:
- R1 fails while R3 succeeds
- This indicates the conservative rung is NOT conservative enough

## Data Collection Template

```json
{
  "testId": "bf-37px-rung-sweep",
  "timestamp": "ISO-8601",
  "setup": {
    "sender": "device model",
    "receiver": "device model",
    "distance_cm": 30,
    "mounting": "tripod/handheld",
    "lighting": "lux if available"
  },
  "runs": [
    {
      "rung": "R1",
      "duration_s": 60,
      "uniquePackets": number,
      "erasureRate": number,
      "cameraFps": number,
      "decodeP50": number,
      "decodeP99": number,
      "framesWithZero": number,
      "byteMismatches": 0,
      "corruptTiles": 0,
      "goodput": number
    },
    // ... R2, R3, R4
  ],
  "conclusion": "PASS/FAIL",
  "killCriterionTripped": false
}
```

## Execution Status

- [ ] R1 test completed
- [ ] R2 test completed
- [ ] R3 test completed
- [ ] R4 test completed
- [ ] Results analyzed
- [ ] Conclusion documented

## Notes

- If the kill criterion is tripped, document the exact conditions and open a new bead to re-derive the ladder
- Results should be added to `docs/notes/spike-results.md` under a new "Rung sweep S2.5" section
- If byte mismatches ≠ 0, stop immediately — this is a stop-everything binary safety failure
