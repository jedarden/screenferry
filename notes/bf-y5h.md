# bf-y5h: EPIC - Close the Wire Format Before Phase 2

## Overview
This EPIC tracks all wire format decisions that must be finalized before Phase 2 (the first phase that writes a decoder) can proceed. Under §16.3, each child is a one-way door—once shipped, changing it strands cached receivers.

## Child Tasks (All Closed ✓)

This EPIC depended on 21 child tasks covering all aspects of the wire format:

1. **bf-312** - Wire format specification
2. **bf-oxv** - Wire format constants
3. **bf-5od** - Wire format structure
4. **bf-f1o** - Wire format validation
5. **bf-28b** - I5 contradiction (concurrent manifest GE context)
6. **bf-28q** - Manifest persistence for resume
7. **bf-5fs** - Wire format beacon design
8. **bf-5fm** - Wire format packet structure
9. **bf-zht** - Wire format block protocol
10. **bf-3b5** - Wire format fragment structure
11. **bf-wiq** - Wire format PRNG determinism
12. **bf-6dm** - Wire format error codes
13. **bf-5mq** - Wire format version negotiation
14. **bf-17v** - Declare L as wire constant for wireVersion 1
15. **bf-1h7** - Add PacketFlags.Manifest; remove Repetition
16. **bf-4yx** - Wire format header design
17. **bf-3ex** - Wire format payload structure
18. **bf-421** - Wire format checksum design
19. **bf-22v** - Generate test fixtures/vectors.json (retire AP10)
20. **bf-vet** - Wire format test coverage
21. **bf-1bd** - Fix Modulation interface before Phase 2

## Verification
All 21 child tasks have been verified as closed. The wire format is now complete and frozen for Phase 2 implementation.

## Why This Matters
Phase 2 (bf-1bp7 - "single-QR optical loop with the real codec") is blocked on this EPIC because:
- It's the first phase that writes a decoder
- Decoder implementations will cache wire format assumptions
- Any wire format change after decoder deployment would break compatibility

## Next Steps
With the wire format closed, Phase 2 can now proceed safely.
