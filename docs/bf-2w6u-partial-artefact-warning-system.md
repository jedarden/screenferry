# Partial Artefact Warning System

**Bead:** `bf-2w6u`  
**Reference:** docs/notes/bf-1yk1-t4b-deletion-lifecycle.md  
**Status:** ✅ Complete

## Overview

Implements user-visible warnings when the receiver would keep a partial artefact instead of deleting it, addressing the T4b threat model requirement for alerting users about persistent plaintext data.

## Features

### 1. Partial Artefact Detection
- **Quota Exhausted (E10):** Detects when storage quota is exhausted during download
- **Decompression Failed (E15):** Detects when decompression fails after completion
- **Incomplete Download:** Detects navigation away before completion
- **Verification Failed:** Detects when blocks fail verification
- **Metadata-based Detection:** Detects partial artefacts from stored metadata

### 2. Security-Focused Warning Dialogs
- **Clear Security Messaging:** Explains that plaintext data persists in OPFS
- **Progress Visualization:** Shows download completion percentage
- **Action Options:** Keep, Delete, Cancel, Export
- **Acknowledgment Requirement:** Requires user acknowledgment of security implications
- **Accessible Design:** Proper ARIA labels and keyboard navigation

### 3. Navigation Guard System
- **BeforeUnload Interception:** Prevents accidental navigation away
- **Browser Native Dialogs:** Uses browser confirmation when custom dialogs unavailable
- **Visibility Change Detection:** Warns when tab is backgrounded with partial data
- **PopState Handling:** Intercepts browser back/forward navigation
- **Statistics Tracking:** Monitors navigation guard activity

## Architecture

### Component Structure

```
src/platform/
├── partial-artefact-detector.ts    # Detection logic
├── partial-warning-dialog.ts        # UI dialog system
└── navigation-guard.ts              # Navigation event handling
```

### Key Interfaces

#### PartialArtefactInfo
```typescript
interface PartialArtefactInfo {
  type: PartialArtefactType;
  streamId: number;
  filename: string;
  completeBlocks: number;
  totalBlocks: number;
  progressPercent: number;
  missingBlocks: number[];
  canResume: boolean;
  securityMessage: string;
}
```

#### WarningDialogResult
```typescript
interface WarningDialogResult {
  action: PartialArtefactAction;
  acknowledged: boolean;
  feedback?: string;
}
```

## Usage

### Basic Integration

```typescript
import {
  detectPartialArtefact,
  shouldWarnOnNavigation
} from './platform/partial-artefact-detector.js';

import {
  showPartialWarningDialog
} from './platform/partial-warning-dialog.js';

import {
  updateNavigationGuardState
} from './platform/navigation-guard.js';

// Update navigation guard with current state
updateNavigationGuardState(currentReceiverState);

// Detect partial artefacts
const partialInfo = detectPartialArtefact(currentReceiverState);
if (partialInfo) {
  // Show warning dialog
  const result = await showPartialWarningDialog(partialInfo, {
    actions: ['keep', 'delete', 'cancel'],
    requireAcknowledgment: true,
  });
  
  // Handle user choice
  switch (result.action) {
    case 'keep':
      // User chose to keep partial artefact
      break;
    case 'delete':
      // User chose to delete partial artefact
      break;
    case 'cancel':
      // User cancelled the operation
      break;
  }
}
```

### Configuration Options

```typescript
import { configurePartialNavigationGuard } from './platform/navigation-guard.js';

configurePartialNavigationGuard({
  enabled: true,
  requireAcknowledgment: true,
  actions: ['keep', 'delete', 'cancel', 'export'],
  onIntercept: (partialInfo) => {
    console.log('Navigation intercepted for partial artefact:', partialInfo);
  },
  onAction: (result, partialInfo) => {
    console.log('User chose action:', result.action);
  },
});
```

### Detection Examples

#### Quota Exhausted Detection
```typescript
if (state.type === 'quota-exhausted') {
  const partial = detectPartialArtefact(state);
  // Returns: PartialArtefactInfo with type='quota-exhausted'
  // Progress: 60% (600 of 1000 blocks)
  // Message: "Storage quota exhausted... plaintext data persists"
}
```

#### Incomplete Download Detection
```typescript
if (state.type === 'receiving') {
  const partial = detectPartialArtefact(state);
  // Returns: PartialArtefactInfo if progress < 100%
  // Message: "Incomplete download... will be stored in plaintext"
}
```

## Security Messages

All warning messages include:

1. **Security Warning Banner:** ⚠️ emoji and clear title
2. **Plaintext Storage Warning:** Explicit mention of unencrypted OPFS storage
3. **Persistence Warning:** Data persists until manually deleted
4. **Progress Information:** Download completion percentage
5. **Action Options:** Clear choices for user
6. **Consequence Explanation:** What happens with each action

### Example Messages

#### Quota Exhausted
```
⚠️ Storage quota exhausted

The file "document.pdf" is 60% complete (600 of 1000 blocks received).

⚠️ SECURITY WARNING: This incomplete file will be stored in plaintext in your browser storage until you delete it.

Browser storage (OPFS) is not encrypted at rest. The incomplete file may persist even after you close this tab.

Options:
• Keep: Store the incomplete file for potential manual recovery
• Delete: Remove the incomplete file from storage
• Cancel: Return to the transfer
```

#### Decompression Failed
```
⚠️ Decompression failed

The file "data.bin" was received but could not be decompressed.

⚠️ SECURITY WARNING: The raw compressed data will be stored in plaintext in your browser storage until you delete it.

Browser storage (OPFS) is not encrypted at rest. The data may persist even after you close this tab.

Options:
• Keep: Store the compressed data for potential manual recovery
• Delete: Remove the data from storage
• Cancel: Stay on this screen
```

## Testing

### Integration Tests
- **File:** `test/partial-artefact-warning-integration.test.ts`
- **Coverage:** 15 tests covering all detection scenarios
- **Status:** ✅ All passing

### Test Categories

1. **Partial Artefact Detection**
   - Quota exhausted state detection
   - Decompression failed state detection
   - Incomplete receiving state detection
   - Paused incomplete state detection
   - Nearly complete threshold (95%)
   - Complete state exclusion

2. **Metadata-based Detection**
   - Partial artefact from stored metadata
   - Compressed artefact detection
   - Complete artefact exclusion

3. **Navigation Guard Integration**
   - Guard enablement on partial state
   - Guard disabled for complete state
   - Statistics tracking

4. **Security Messages**
   - Quota exhausted message content
   - Decompression failed message content
   - Action options clarity

## Compliance

### T4b Threat Model (§12)
- ✅ Explicit warnings before keeping partial artefacts
- ✅ Security context about plaintext storage
- ✅ User acknowledgment requirements
- ✅ Clear action options with consequences

### Edge Case Integration
- ✅ **E10 (Quota Exhausted):** Warning + acknowledgment required
- ✅ **E15 (Decompression Failed):** Warning + acknowledgment required
- ✅ **Navigation Away:** Warning before leaving with incomplete data

### User Communication
- ✅ Clear security warnings
- ✅ Progress visualization
- ✅ Action consequence explanation
- ✅ Persistent storage notification

## Implementation Notes

### Browser Limitations
- **BeforeUnload Dialogs:** Cannot show custom dialogs, must use browser native confirmation
- **Async Operations:** beforeunload doesn't support promises, navigation guard uses hybrid approach
- **Tab Close:** Cannot prevent tab close, can only warn via beforeunload

### Design Decisions
1. **95% Threshold:** Don't warn if nearly complete to avoid user annoyance
2. **Acknowledgment Checkbox:** Required for security-sensitive actions
3. **Progress Visualization:** Color-coded progress bar (red < 25%, orange < 50%, etc.)
4. **Modal Overlay:** Backdrop blur to focus attention
5. **Escape Key Dismiss:** Standard UX pattern

### Security Considerations
- **No False Sense of Security:** Explicitly states OPFS is not encrypted
- **Persistent Storage Warning:** Clear that data survives tab close
- **No Silent Storage:** User must acknowledge before keeping partial data
- **Delete Option:** Always available for immediate cleanup

## Files Modified/Created

### New Files
1. `src/platform/partial-artefact-detector.ts` - Detection logic
2. `src/platform/partial-warning-dialog.ts` - UI dialog system  
3. `src/platform/navigation-guard.ts` - Navigation event handling
4. `test/partial-artefact-warning-integration.test.ts` - Integration tests

### Integration Points
- `src/core/session/types.ts` - Session state types
- `src/platform/storage.ts` - Storage manager integration
- `src/platform/export.ts` - Export system integration

## Future Enhancements

### Potential Improvements
1. **Notification API:** Browser notifications when tab is backgrounded
2. **Analytics Tracking:** Monitor how often users keep vs delete partial data
3. **Recovery UI:** Dedicated screen for managing partial artefacts
4. **Auto-cleanup Timer:** Option to auto-delete partial data after N hours
5. **Compression Warnings:** Additional warnings for compressed artefacts

### UX Refinements
1. **Smart Thresholds:** Adjust warning threshold based on file size
2. **Recovery Suggestions:** Suggest recovery options for partial data
3. **Batch Operations:** Handle multiple partial artefacts simultaneously
4. **Export Improvements:** Better export options for partial data

## References

- **T4b Specification:** docs/notes/bf-1yk1-t4b-deletion-lifecycle.md
- **Security Model:** plan.md §12
- **Edge Cases:** plan.md §10 (E10, E15)
- **OPFS Spec:** https://fs.spec.whatwg.org/

---

**Implementation Complete:** All acceptance criteria met
- ✅ Warning before keeping partial artefacts
- ✅ Security implication explanations
- ✅ User action choices (Keep/Delete/Cancel)
- ✅ Dismissible but security-contextual
- ✅ Only shown for genuinely partial artefacts
