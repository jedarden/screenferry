# Partial Artefact Warning Integration Guide

## Overview

The partial artefact warning system (bf-2w6u) has been integrated into the camera receiver UI to warn users when they navigate away from incomplete file transfers. This prevents accidental data loss and ensures users are aware of security implications.

## Integration Points

### 1. Camera Receiver UI Integration

The `CameraReceiverUI` class now includes navigation guard integration:

```typescript
import { updateSessionState } from './camera-receiver-ui.js';

// When receiver session state changes, update the UI
receiverUI.updateSessionState(newState);
```

### 2. Receiver Session State Management

The navigation guard automatically activates when the receiver enters a partial state:

- **receiving** (when < 95% complete)
- **paused** (when incomplete)
- **quota-exhausted**
- **decompress-failed**

The guard remains disabled for:
- **idle** state
- **complete** state
- Nearly complete transfers (> 95%)

### 3. User Experience

When a user attempts to navigate away during a partial transfer:

1. **Browser beforeunload**: Native browser dialog warns about incomplete transfer
2. **Browser back/forward**: Custom security dialog shows detailed options
3. **Tab backgrounding**: Warning logged (can trigger notification)

## Usage Example

```typescript
// In your receiver implementation
import { createCameraReceiverUI } from './camera-receiver-ui.js';
import type { RecvSessionState } from './core/session/types.js';

// Create the UI
const receiverUI = createCameraReceiverUI({ container });

// Start the receiver
await receiverUI.start();

// When transfer begins (receiving state)
receiverUI.updateSessionState({
  type: 'receiving',
  streamId: 123,
  meta: { /* beacon metadata */ },
  complete: new Uint8Array([/* block bitmap */]),
  writtenBlocks: new Uint8Array([/* written bitmap */]),
  active: null,
  manifestActive: null,
  out: null,
  manifest: null,
  stats: { /* stats */ }
});

// When transfer completes
receiverUI.updateSessionState({
  type: 'complete',
  streamId: 123,
  meta: { /* beacon metadata */ },
  complete: completeBitmap,
  writtenBlocks: writtenBitmap,
  outputPath: '/output/file.txt',
  outputSize: 1024000,
  verified: true,
  compressed: false
});

// Stop the receiver (disables navigation guard)
await receiverUI.stop();
```

## Security Features

### Warning Dialog Components

The security warning dialog includes:

1. **Security Context**: Explains that plaintext data persists in OPFS
2. **Progress Information**: Shows completion percentage and block count
3. **Action Options**:
   - **Keep**: Store incomplete file for potential manual recovery
   - **Delete**: Remove incomplete file from storage
   - **Cancel**: Stay on current screen and continue transfer
   - **Export**: Export compressed data (for decompress-failed state)

### Protection Scope

The navigation guard protects against:
- Accidental page navigation (back/forward buttons)
- Tab/window closure
- URL changes
- Tab backgrounding (logged warning)

It does NOT interfere with:
- Complete transfers (> 95% complete)
- Completed files
- Idle state (no active transfer)

## Technical Implementation

### State Detection

The `partial-artefact-detector.ts` module detects partial artefacts from receiver session states:

```typescript
import { detectPartialArtefact, shouldWarnOnNavigation } from './partial-artefact-detector.js';

const partial = detectPartialArtefact(state);
if (partial) {
  // Shows warning with security context
  console.log(partial.securityMessage);
}
```

### Warning Dialog

The `partial-warning-dialog.ts` module provides the security-focused dialog:

```typescript
import { showPartialWarningDialog } from './partial-warning-dialog.js';

const result = await showPartialWarningDialog(partialInfo, {
  actions: ['keep', 'delete', 'cancel'],
  requireAcknowledgment: true
});
```

### Navigation Guard

The `navigation-guard.ts` module handles navigation events:

```typescript
import { updateNavigationGuardState } from './navigation-guard.js';

// Automatically enables/disables based on state
updateNavigationGuardState(sessionState);
```

## Testing

The integration includes comprehensive tests in `test/partial-artefact-warning-integration.test.ts`:

- Partial artefact detection from various states
- Navigation guard enable/disable logic
- Security message formatting
- User action handling
- Progress tracking

Run tests with:
```bash
npm test -- partial-artefact-warning-integration.test.ts
```

## Files Modified

- `src/platform/camera-receiver-ui.ts`: Added navigation guard integration
- `src/platform/partial-artefact-detector.ts`: Detection logic (already implemented)
- `src/platform/partial-warning-dialog.ts`: Warning dialogs (already implemented)
- `src/platform/navigation-guard.ts`: Navigation guards (already implemented)

## References

- Original task: bf-2w6u
- Security requirement: T4b deletion lifecycle
- Related: bf-1yk1 session state management
- Related: bf-1zxy local-diagnostics rule (no payload logging)
