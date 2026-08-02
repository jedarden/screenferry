# bf-4wwl: Define what the whole-file hash covers

## Issue

plan.md §7.2, E15 leaves an ambiguity about what the whole-file hash actually covers when compression is enabled.

- **Original file (before compression)?** 
- **Decompressed reassembly (after decompression)?**

E15 states: "Decompression fails at the end → `E-DECOMPRESS`; keep the compressed artefact so nothing is lost."

If the hash can only be computed on the decompressed output, but we're keeping the compressed artefact when decompression fails, then the hash can never be evaluated at all. This is the case the task is asking about.

## Analysis

### What the plan currently says

§7.2 beacon packet field:
> `wholeFileHash` | 32 | **Mandatory.** ... Computed by streaming the reassembled file through an incremental WASM hasher (§3.3); the cost is one extra read, not one extra copy

§3.3 (referenced by §7.2):
> The whole-file hash cannot be computed in one pass
> `crypto.subtle.digest` has **no streaming API** — it takes one buffer.
> **Fix:** per-block hashes ... plus a mandatory whole-file hash from an incremental WASM hasher. concept.md constraint 4 makes byte-exact reconstruction non-negotiable and names the whole-file hash as the verification (see §7.2).

concept.md constraint 4:
> 4. **Byte-exact reconstruction.** The received file must be bit-identical to the source. Verified by a whole-file hash carried in the stream. Silent corruption is worse than failure.

§6.4 receiver pipeline:
```
all blocks present & manifest decoded ──► verify all blocks
                                                    ──► [decompress] ──► save
```

### The problem: E15 creates a hash-verification dead-end

When compression is enabled (D8):
1. Sender: original file → compress → blocks → fountain encode → transmit
2. Receiver: receive → fountain decode → verify blocks → decompress → save

When decompression fails (E15):
- Keep the compressed artefact (the received, fountain-decoded blocks)
- But the whole-file hash was computed on the **decompressed output**
- Without decompression, there's nothing to hash
- The hash can never be evaluated

This is the circular dependency: **you need decompression to compute the hash, but you need the hash to verify decompression succeeded**.

## Resolution

### Clarify §7.2 wholeFileHash field description

**Current wording (ambiguous):**
> Computed by streaming the reassembled file through an incremental WASM hasher (§3.3); the cost is one extra read, not one extra copy

**Clarified wording (explicit):**
> Computed on the **decompressed reassembly** (after decompression, if compression is enabled; otherwise on the received blocks directly). The sender hashes the original file by streaming it through an incremental WASM hasher. The receiver hashes its decompressed output and compares. The hash covers the final user-visible output, not intermediate compressed data. If decompression fails (E15), the hash cannot be evaluated and the compressed artefact is kept unverified.

### Clarify E15 to acknowledge hash verification is impossible

**Current wording (silent on hash implication):**
> | E15 | **Decompression fails at the end** | All blocks verified but the gzip stream is invalid → `E-DECOMPRESS`; keep the compressed artefact so nothing is lost. **The kept artefact follows T4b's deletion lifecycle** — warn the user before keeping it, provide a delete control, and reap on startup. |

**Clarified wording (explicit about hash):**
> | E15 | **Decompression fails at the end** | All blocks verified (per-block hashes passed) but the gzip stream is invalid → `E-DECOMPRESS`. Keep the compressed artefact so nothing is lost, but note that **the whole-file hash cannot be evaluated** — it requires successful decompression to compute. The kept artefact follows T4b's deletion lifecycle: warn the user before keeping it (explicitly noting it is **unverified**), provide a delete control, and reap on startup. The compressed artefact is received data that passed per-block verification but failed decompression; it cannot be surfaced to the user as the original file. |

### Clarify the receiver pipeline to show hash is after decompression

The §6.4 pipeline already shows decompression before save, but the whole-file hash verification isn't explicitly placed. The pipeline should make clear that:

1. Blocks arrive → fountain decode → write to OPFS
2. Manifest arrives → verify each block's hash
3. All blocks verified → **decompress** (if compressed)
4. **Compute whole-file hash on decompressed output**
5. Compare with beacon's `wholeFileHash`
6. If match → save; if mismatch → `E-FILE-HASH`
7. If decompression fails → `E-DECOMPRESS`, keep compressed artefact, hash cannot be evaluated

## Summary

**The whole-file hash covers the decompressed reassembly** (the final output the user receives), not the original pre-compression file and not the intermediate compressed blocks.

When compression is enabled:
- **Sender side:** Hash computed on the original file (which equals what the receiver will get after decompression)
- **Receiver side:** Hash computed on the decompressed output (the reassembled blocks, run through decompression)
- **If decompression fails:** The hash cannot be evaluated at all. E15 keeps the compressed artefact, but it's fundamentally unverified because there's nothing usable to hash.

This is intentional: the hash guarantees byte-exact reconstruction of the **deliverable**, not the intermediate representation. The compressed artefact kept by E15 is emergency data recovery — it passed per-block verification (so the fountain layer worked) but failed the final format conversion (decompression). It's better than nothing, but it's not the verified file the whole-file hash promises.
