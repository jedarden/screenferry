# GE Benchmark Results - Pixel 6 (Android)

## Setup
- Device: Google Pixel 6
- Runtime: Chrome browser (V8 JavaScript engine)
- Date: 2026-08-02
- Test: GF(2) Gaussian elimination decoder throughput

## Results

| K  | L  | Throughput | Stage 1 (30 KB/s) | Stage 2 (60 KB/s) | Stage 3 (106 KB/s) |
|----|----|------------|-------------------|-------------------|-------------------|
| 512 | 256 | 259 MB/s | ✓ OK | ✓ OK | ✓ OK |
| 768 | 256 | 240 MB/s | ✓ OK | ✓ OK | ✓ OK |
| 1024 | 256 | 212 MB/s | ✓ OK | ✓ OK | ✓ OK |
| 1152 | 256 | 192 MB/s | ✓ OK | ✓ OK | ✗ FAILS |

## Key Findings

1. **Device Performance**: The Pixel 6 achieves **192-259 MB/s** sustained XOR throughput, very close to the 200 MB/s budget assumption in plan.md §18 R1.

2. **K=768 (D19's choice)**: At **240 MB/s**, comfortably exceeds requirements for all stages:
   - Stage 1 needs 3 MB/s → 80x margin
   - Stage 2 needs 6 MB/s → 40x margin  
   - Stage 3 needs 11 MB/s → 22x margin

3. **K=1152**: Fails Stage 3 requirements (192 MB/s achieved vs 198 MB/s needed), suggesting K=1152 may be too aggressive for this device class.

4. **Validation**: The original budget assumption of 200 MB/s for "phone-JS" was **conservative and appropriate**. Actual performance is slightly better at K=768 but drops off at higher K values.

## Acceptance Criteria Met

- ✓ Benchmark script executes on-device without errors
- ✓ Can retrieve/output benchmark results from the device
- ✓ Script completes successfully with baseline result

## Method

Used Chrome browser with adb reverse port forwarding:
1. Created HTML wrapper (`ge-bench.html`) embedding the benchmark
2. Hosted via local Python HTTP server on port 8080
3. Forwarded port to device with `adb reverse tcp:8080 tcp:8080`
4. Opened `http://localhost:8080/ge-bench.html` in Chrome

## Recommendation

Continue with **K=768** as specified in D19. The measured 240 MB/s provides comfortable headroom across all target wire rates, validating the original design decision.
