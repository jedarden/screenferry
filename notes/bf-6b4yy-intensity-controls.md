# Intensity Level Controls - Implementation Notes (bf-6b4yy)

## Overview
Configurable intensity levels have been successfully implemented for the Android stress test application. The intensity controls allow users to adjust CPU and GPU workload from 1-10, with preset buttons for Low (3), Medium (5), and High (8).

## Acceptance Criteria ✅

### 1. Adjustable Intensity Levels
- **SeekBar Control**: 1-10 scale (10-100% intensity)
- **Preset Buttons**:
  - Low: Intensity 3
  - Medium: Intensity 5 (default)
  - High: Intensity 8

### 2. Intensity Affects Actual Load

#### CPU Stress Parameters
- **Thread Count**: `intensity + 1` (2-11 threads)
  - Intensity 1 → 2 threads
  - Intensity 5 → 6 threads
  - Intensity 10 → 11 threads

- **Computational Load**:
  - Iterations per loop: `100 + (intensity × 100)`
  - Matrix size: `4 + intensity/2` (4-9 matrix)
  - Prime count: `10 + intensity`
  - Fibonacci calculation: `20 + intensity`
  - Sleep time: `max(1, 10 - intensity)` ms

#### GPU Stress Parameters
- **Quad Count**: `1 + intensity` (2-11 quads per frame)
- **Frame Rate**: Continuous rendering (`RENDERMODE_CONTINUOUSLY`)
- **Operations**: Vertex transformations, pixel shading, texture simulation

### 3. User Interface
- **Main UI**: Activity with SeekBar and preset buttons
- **Status Display**:
  - Current intensity level with text label (Low/Medium/High)
  - CPU operations counter (M ops)
  - GPU frame counter
  - Running time (MM:SS format)

### 4. Persistent Settings
- **Storage**: Android SharedPreferences
- **Preference File**: `StressTestPrefs`
- **Key**: `intensity`
- **Persistence**:
  - Auto-saves when user changes intensity via SeekBar
  - Auto-saves when user clicks preset buttons
  - Loads on app startup (default: 5)

## Implementation Details

### File: StressTestActivity.java
- **Lines 22-23**: Preference keys defined
- **Lines 28-34**: UI components (SeekBar, buttons, TextViews)
- **Lines 56**: Loads saved intensity on startup
- **Lines 62-63**: Restores intensity to SeekBar
- **Lines 87-105**: SeekBar listener with auto-save
- **Lines 108-110**: Preset button click handlers
- **Lines 116-132**: Intensity display update with labels
- **Lines 143-144**: Intensity used to calculate thread count
- **Lines 158-161**: CPU workers spawned with intensity
- **Lines 164-165**: GPU worker spawned with intensity
- **Lines 266-280**: SharedPreferences save/load methods

### File: CPUStressWorker.java
- **Lines 13-20**: Intensity parameter stored
- **Lines 41**: Iterations calculated from intensity
- **Lines 45-46**: Matrix size based on intensity
- **Lines 51-52**: Prime count based on intensity
- **Lines 55**: Fibonacci length based on intensity
- **Lines 62-63**: Sleep time inversely proportional to intensity

### File: GPUStressWorker.java
- **Lines 19-31**: Intensity parameter stored and passed to renderer
- **Lines 248-251**: Quad count calculated from intensity

### File: activity_stress_test.xml
- **Lines 20-88**: Intensity control UI layout
  - Label (Lines 20-28)
  - Preset buttons (Lines 31-71)
  - SeekBar (Lines 73-78)
  - Intensity display (Lines 80-87)

## Verification

### Manual Verification Steps
1. Install the APK on a Pixel 6 device
2. Open the stress test app
3. Verify intensity defaults to 5 (Medium)
4. Test preset buttons:
   - Click "Low" → SeekBar moves to 3, display shows "Low"
   - Click "Medium" → SeekBar moves to 5, display shows "Medium"
   - Click "High" → SeekBar moves to 8, display shows "High"
5. Test SeekBar: Drag to different values, display updates immediately
6. Start stress test, verify CPU/GPU status shows activity
7. Stop test, adjust intensity, restart - verify different load
8. Close app, reopen - verify intensity persists

### CPU Verification
Use `adb shell top -m 10` to monitor CPU usage during stress test:
- Low (3): Expect ~30-50% CPU usage
- Medium (5): Expect ~50-70% CPU usage
- High (8+): Expect ~70-100% CPU usage

### GPU Verification
Monitor GPU rendering via SurfaceFlinger:
```bash
adb shell dumpsys SurfaceFlinger | grep -A 5 "GPU"
```
Higher intensity should show more draw calls and frame activity.

## Design Decisions

1. **Intensity Scale (1-10)**: Provides fine-grained control without overwhelming users
2. **Presets (3, 5, 8)**: Gives users quick access to common levels
3. **Auto-save on Change**: Immediate persistence prevents data loss
4. **Thread Count Formula**: `intensity + 1` ensures at least 2 threads even at minimum
5. **Sleep Time Inverse**: Higher intensity = less sleep = more consistent load
6. **OpenGL ES 1.0**: Chosen for maximum device compatibility

## Future Enhancements
- Add custom intensity value input (beyond 10)
- Add temperature monitoring and auto-throttling
- Add battery drain rate display
- Add benchmark mode (fixed duration tests)
- Add CSV export for test results

## Testing
Built successfully with `./gradlew assembleDebug` - no compilation errors.

## Files Modified
- `android-stress-test/app/src/main/java/com/screenferry/stresstest/StressTestActivity.java`
- `android-stress-test/app/src/main/java/com/screenferry/stresstest/CPUStressWorker.java`
- `android-stress-test/app/src/main/java/com/screenferry/stresstest/GPUStressWorker.java`
- `android-stress-test/app/src/main/res/layout/activity_stress_test.xml`
