# bf-6anq: E-ORIENTATION Coaching Implementation

## Status: ✅ COMPLETE

E-ORIENTATION coaching is fully implemented and tested.

## Implementation Summary

Per plan.md §6.3.2 and §11, E-ORIENTATION provides receiver orientation coaching to help users achieve optimal performance (1.78× improvement in landscape).

### Key Design Principles

- **Coaching, not configuration**: Cannot force OS orientation — sensor mapping follows device body
- **INFO severity**: Portrait is fully supported, landscape is optional improvement
- **Free bonus**: Landscape provides 1.78× performance improvement without requiring sender-side changes
- **No combination**: Do NOT use both sender-side portrait region + receiver-side landscape (would over-optimize)

### Core Implementation

**Orientation Detection** (`src/platform/orientation.ts`):
- `detectOrientation(width, height)` - Detects device orientation from camera capture dimensions
- `getOrientationCoaching(detection)` - Returns coaching message when not optimal
- `shouldShowOrientationCoaching(detection)` - Determines when to show coaching
- Helper functions: `getAspectRatio()`, `isLandscape()`, `isPortrait()`

**Error Code Definition** (`src/core/errors/error-codes.ts`):
```typescript
'E-ORIENTATION': {
  category: 'optical',
  recoverable: true,
  severity: ErrorSeverity.INFO
}
```

**User-facing message**:
> "This app works fine held normally — but if you'd like more margin, match the orientation setting on the sending device, or turn the phone sideways."

### Integration Points

- **Health check system**: Pre-flight validation via `src/platform/health-check.ts`
- **Modulation layer**: Integration with encoding layer via `src/modulation/types.ts`
- **Phase 5 UI**: Ready for receiver UI integration (not yet implemented)

### Test Coverage

Comprehensive test suite in `test/orientation.test.ts`:
- ✅ 20 tests covering all orientation detection scenarios
- ✅ Landscape/portrait detection logic
- ✅ Coaching message generation
- ✅ Utility functions
- ✅ E-ORIENTATION informational nature
- ✅ Edge cases (square dimensions, invalid inputs)

All tests pass: `20/20` ✅

### Performance Impact

**Landscape orientation**:
- Provides 1.78× improvement in camera px/module
- Free performance bonus (no sender-side changes required)
- Does not require halving screen px/module (unlike sender-side portrait region)

**Portrait orientation**:
- Fully supported and is the default case
- No blocking errors - only coaching at INFO severity
- App works fine in portrait without any user action

## Architecture Decisions

### Why Coaching Instead of Configuration

Forcing OS orientation does not work because sensor mapping follows the device body, not the screen orientation. This makes E-ORIENTATION a coaching feature rather than a configuration setting.

### INFO Severity Rationale

Portrait mode is fully functional and achieves the required performance thresholds. Landscape is optional optimization, not a requirement. E-ORIENTATION is therefore classified as INFO severity, not WARNING or ERROR.

### No Sender-Side Changes Required

Unlike sender-side portrait region selection (which requires coordination), receiver-side landscape orientation is purely local and provides immediate benefits without protocol changes.

## References

- **plan.md §6.3.2**: Shape the code region to the CAMERA, not the screen
- **plan.md §11**: Error taxonomy - E-ORIENTATION definition
- **bf-1g0**: F3 aim reticle and distance coach (related but separate coaching feature)
- **spike-results.md**: Verified 1.78× landscape improvement

## Next Steps

The implementation is complete and ready for Phase 5 receiver UI integration. No further work required unless UI implementation reveals integration issues.

---

**Bead completed**: 2026-08-02  
**Implementation status**: Production-ready  
**Test coverage**: Complete (20/20 tests passing)