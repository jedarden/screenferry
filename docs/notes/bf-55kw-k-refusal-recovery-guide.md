# K-Based Refusal Recovery Guide

**Bead:** bf-55kw  
**Status:** Complete  
**References:** plan.md D26, T1, §16.4

## Recovery Overview

When a receiver refuses a stream with `E-K-OVERFLOW`, the recovery process is **asymmetric** - the action must be taken on the **sender device**, not the receiver. This is a fundamental constraint of screenferry's architecture.

## Recovery Process

### 1. Understanding the Error

**User sees:** 
> "Sender's chunk size (K=800) exceeds this device's maximum supported complexity (K_max=768). The sender must use a smaller file or reduce K."

**What happened:**
- Receiver measured its device's GE decoder throughput
- Derived K_max = 768 (maximum K it can handle)
- Incoming stream has K = 800 (from `blockSize / L`)
- Stream refused to prevent resource exhaustion

### 2. Recovery Actions (Sender-Side Only)

#### Option A: Use a Smaller File
**Recommended approach** - reduces K automatically

1. **Compress the file** before sending
   - Enable compression on sender
   - Smaller compressed size → smaller K
   - Example: 500 MB file → K=800, 100 MB compressed → K=256

2. **Split the file** into smaller chunks
   - Send files individually instead of one large file
   - Each chunk has smaller K
   - Receiver reassembles on disk

#### Option B: Re-benchmark the Receiver (Advanced)
**For technical users** - increases K_max on receiver

1. **Receiver runs manual GE benchmark:**
   - Open screenferry health check
   - Click "Re-benchmark" button
   - Wait for benchmark to complete (5-10 seconds)

2. **If K_max increased:**
   - Receiver can now handle larger K
   - Retry the same transfer

3. **If K_max unchanged:**
   - Device genuinely cannot handle larger K
   - Must use Option A (smaller file)

#### Option C: Use a More Powerful Receiver
**Hardware limitation** - different device needed

1. **Use a desktop/laptop as receiver**
   - Desktops have higher GE throughput
   - Can handle K=1024-2048
   - Transfer from phone → desktop, then desktop → target phone

2. **Use a higher-end phone as receiver**
   - Newer phones have faster CPUs
   - May support higher K_max
   - Check health check benchmark results

### 3. What NOT To Do

❌ **Do NOT adjust receiver settings** - K_max is measured, not configured  
❌ **Do NOT retry with same file** - will get same error  
❌ **Do NOT restart receiver app** - K_max is cached in IndexedDB  
❌ **Do NOT ignore the error** - transfer would fail anyway (frame drops)

## The No Back-Channel Constraint

### Why There's No Back-Channel

Screenferry is **strictly one-way** (screen → camera). The receiver has:

```typescript
// Receiver can ONLY:
- Read beacons from camera frames
- Decode packets
- Store received chunks

// Receiver CANNOT:
- Send messages to sender
- Request parameter adjustments
- Signal capabilities to sender
- Query sender's device type
```

### Architecture Implications

**Sender assumes the weakest receiver:**
```typescript
// Per D26: Sender MUST be conservative
const K = 768; // Conservative floor (works on phones)
// Sender MAY increase to 1024-2048 if user confirms receiver is desktop
```

**Receiver measures locally:**
```typescript
// Per D26: Receiver derives K and MUST refuse if K > K_max
const localKMax = await runGEBenchmark(); // Measure, don't assume
if (beaconK > localKMax) {
  throw new StreamRefusedError('E-K-OVERFLOW');
}
```

### No Negotiation Protocol

Unlike traditional networking:
- **TCP:** SYN/SYN-ACK handshake, both parties agree on parameters
- **HTTP:** Client declares capabilities, server responds accordingly
- **Screenferry:** Sender chooses parameters blindly, receiver can only accept/refuse

This constraint is **architectural, not a bug**:
- Enables air-gapped transfers (no network needed)
- Eliminates pairing complexity (no Bluetooth handshake)
- Works across device types (phone → tablet → laptop)

## Recovery Flow Diagram

```
┌─────────────────┐     K=800      ┌─────────────────┐
│   SENDER        │ =============> │   RECEIVER      │
│   (phone)       │                │   (old phone)   │
└─────────────────┘                └─────────────────┘
                                              │
                                              │ E-K-OVERFLOW
                                              │ (K_max=768)
                                              ↓
                                    ┌─────────────────┐
                                    │  USER SEES      │
                                    │  ERROR MESSAGE  │
                                    └─────────────────┘
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    │                                                   │
                    ↓                                                   ↓
          ┌──────────────────┐                              ┌──────────────────┐
          │ SENDER ACTS      │                              │ RECEIVER STAYS  │
          │ (no back-channel)│                              │   PUT           │
          └──────────────────┘                              └──────────────────┘
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ↓               ↓               ↓
┌─────────┐   ┌─────────┐   ┌─────────────┐
│ Compress│   │  Split  │   │  Use desktop│
│  file   │   │  file   │   │  receiver   │
└─────────┘   └─────────┘   └─────────────┘
    │               │               │
    └───────────────┼───────────────┘
                    ↓
          K=800 → K=256-512
                    │
                    ↓
          ┌─────────────────┐
          │  RETRY TRANSFER │
          └─────────────────┘
                    │
                    ↓
          ✓ Transfer succeeds
```

## User-Facing Error Messages

### Standard Error Message
```
Sender's chunk size (K=800) exceeds this device's maximum 
supported complexity (K_max=768). 

The sender must use a smaller file or reduce K.

Recovery options:
1. Compress the file before sending
2. Split into smaller files  
3. Use a more powerful receiver device
```

### Detailed Error Message (with context)
```
Transfer refused: K=800 exceeds receiver's K_max=768

This transfer would fail because this device cannot decode 
chunks of this size fast enough. This prevents frame drops 
and transfer failure.

WHAT TO DO (on the SENDING device):
• Compress the file to reduce K (recommended)
• Send smaller files individually
• Use a desktop as receiver instead

The receiver has already measured its maximum capacity and 
cannot handle this transfer size.
```

## Testing Recovery Scenarios

```typescript
// test/k-refusal-recovery.test.ts (proposed)
describe('K-based refusal recovery', () => {
  it('shows clear recovery message on K overflow');
  it('mentions sender must act, not receiver');
  it('explains no back-channel exists');
  it('suggests compression as primary solution');
  it('provides fallback options (split file, desktop receiver)');
});
```

## Documentation Updates Needed

- [x] Error code specification (`bf-55kw-k-refusal-error-codes.md`)
- [x] Recovery guide (this document)
- [x] Security model documentation
- [ ] User-facing message updates in UI code
- [ ] Help center article on K overflow errors
- [ ] Troubleshooting guide section

## Version History

| Date | Change |
|------|--------|
| 2026-08-02 | Initial recovery guide for bf-55kw |
