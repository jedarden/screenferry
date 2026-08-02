# tools/ — Retained Infrastructure

This directory contains **retained infrastructure** for the two-device optical rig, unlike the `spike/` directory which is deleted once results land.

## Purpose

The tools here drive the **T-physical-rig tier** (plan.md §14.1), which is the *only* way to measure the optical budgets specified in §13.1. These scripts orchestrate real-world device testing where one device sends and another receives via camera.

## Files

### `devrig.sh` — Two-device rig orchestration

Drives the two-device optical rig for Phase 0.5 S2/S3/S4 measurements with no human in the loop (except for physically aiming the phone at the bench screen).

**Setup:**
- **bench (Lenovo T450s, X on :0, 1920×1080)** → SENDER, Chromium kiosk mode
- **Pixel 6 over ADB** → RECEIVER, Chrome
- **this host** → Vite HTTPS server + orchestration

**HTTPS is mandatory:** `getUserMedia` needs a secure context, so the phone must load the receiver over a real certificate. The script uses `tailscale cert` to issue one for this host's tailnet name, which means no interstitial to tap through — important when driving via ADB.

**Usage:**
```bash
tools/devrig.sh serve      # Start the dev server (foreground)
tools/devrig.sh cert       # (re)issue the TLS cert
tools/devrig.sh send R2 4 4 3 12
tools/devrig.sh recv R2 4 4 3 12
tools/devrig.sh run  R2 4 4 3 12 45     # Both ends, wait N seconds, collect results
tools/devrig.sh shots                   # Screenshot both screens
tools/devrig.sh stop
```

**Parameters:** `rung mod cols rows fps` (e.g., `R2 4 4 3 12`)
- `rung`: Modulation profile (R1=conservative v10-L, R2=nominal v15-L, R3=aggressive v20-L)
- `mod`: Module size (screen pixels)
- `cols`, `rows`: Grid dimensions
- `fps`: Frame rate

**Outputs:**
- Screenshots saved to `test-results/`
- `window.sfStats` scraped via Chrome DevTools Protocol and saved as JSON

### `cdp_eval.py` — Chrome DevTools Protocol evaluator

Evaluates JavaScript expressions in a Chrome tab over the DevTools protocol.

**Used by `devrig.sh`** to read `window.sfStats` off the phone without OCR — the numbers matter too much to read them out of a JPEG.

**Usage:**
```bash
python3 cdp_eval.py <ws-url> '<js expression>'
```

**Protocol:** Speaks just enough WebSocket framing to avoid dependencies — payloads are small and single-frame.

## Onboarding Constraints — HTTPS via Tailscale cert

The rig requires HTTPS for camera access (`getUserMedia` needs a secure context). This is documented in `vite.config.ts` but **absent from plan.md §16.2**:

1. **Certificate issuance:** Run `sudo tailscale cert --cert-file .certs/sf.crt --key-file .certs/sf.key <host>.<tailnet>.ts.net`
2. **Vite configuration:** `vite.config.ts` loads these certificates for the dev server
3. **No interstitial:** The Tailscale-issued cert is trusted by the phone, avoiding manual certificate acceptance that would block ADB-driven testing

**This is a real onboarding constraint:** Developers setting up the rig for the first time must:
- Have Tailscale installed
- Be on the same tailnet
- Run the certificate issuance step before starting the server
- Keep certificates refreshed (Tailscale certs expire)

## Relationship to Testing Tiers

This rig enables **T-physical-rig** (plan.md §14.1), which is:
- **Two real devices, fixed mounting, the §13.2 denominator**
- **The acceptance gate for §13.1 throughput** — nothing else can measure it
- Runs **per release**

The rig measures the actual optical channel performance under controlled conditions, which is the only way to validate the throughput budgets in §13.1.

## Relationship to Spike

Unlike `spike/` (which is deleted once results land per spike/README.md), this directory is **retained infrastructure** because:
- The optical rig is needed for **every release** (T-physical-rig runs per release)
- S2/S3/S4 measurements may need to be repeated as the system evolves
- The scripts are reusable instrumentation, not one-time experiments
- They provide the canonical way to measure §13.1's optical budgets

The rig itself is not the spike — the spike is the throwaway code that generates test patterns. The rig infrastructure (`devrig.sh`, `cdp_eval.py`) stays.
