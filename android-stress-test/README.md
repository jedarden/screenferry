# Android CPU/GPU Stress Test Application

A comprehensive stress testing tool for Android devices that loads both CPU and GPU to trigger thermal throttling.

## Features

- **Configurable Intensity Levels**: 1-10 intensity settings
- **CPU Stress Testing**: Multi-threaded mathematical operations
- **GPU Stress Testing**: OpenGL ES rendering operations
- **Real-time Monitoring**: Live status updates and operation counts
- **Adjustable Duration**: Run for as long as needed (5+ minutes easily achievable)
- **Safe Operation**: Includes safeguards and temperature monitoring

## Building the APK

### Prerequisites
- Android SDK (API level 24+)
- Gradle
- Java 8+

### Build Instructions

```bash
cd android-stress-test

# Clean and build
./gradlew clean
./gradlew assembleDebug

# The APK will be at: app/build/outputs/apk/debug/app-debug.apk
```

## Installation

### Via ADB

```bash
# Install the APK
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Launch the app
adb shell am start -n com.screenferry.stresstest/.StressTestActivity
```

## Usage

### Through the App

1. **Launch the app** on your Android device
2. **Adjust intensity** (1-10) using the seek bar:
   - 1-3: Low intensity (good for basic testing)
   - 4-7: Medium intensity (recommended for thermal throttling)
   - 8-10: High intensity (maximum heat generation)
3. **Press "Start Stress Test"**
4. **Monitor** the CPU/GPU status and running time
5. **Press "Stop"** when finished

### Recommended Settings for Thermal Throttling

- **Intensity**: 7-8 (high enough to trigger throttling quickly)
- **Duration**: 5-10 minutes
- **Expected Results**:
  - Device battery temperature: 35-42°C
  - CPU frequency reduction: 30-50%
  - Thermal throttling activation: 2-5 minutes

## Technical Details

### CPU Stress Testing

The app uses multiple worker threads that perform:
- **Matrix multiplication**: 4x4 to 9x9 matrix operations
- **Prime number calculation**: Finding primes in ranges
- **Fibonacci sequence**: Recursive calculations
- **Intensive loops**: Iteration counts scale with intensity

Number of threads: `intensity + 1` (2-11 threads)

### GPU Stress Testing

The GPU stress worker performs:
- **Vertex transformation**: Matrix operations on 3D vertices
- **Pixel shading**: Color calculations and lighting
- **Texture mapping**: Texture generation and filtering
- **OpenGL ES rendering**: Actual GPU rendering operations

Operation counts scale with intensity setting.

### Safety Features

- **Wake lock**: Keeps screen on (prevents sleep during testing)
- **Graceful shutdown**: Proper cleanup of all threads
- **Status monitoring**: Real-time feedback on system state
- **Emergency stop**: Easy stop button to halt operations

## Monitoring Thermal Throttling

Use the companion scripts to monitor thermal throttling:

```bash
# Monitor thermal status
./scripts/monitor-thermal.sh monitor 10 600

# Take a snapshot
./scripts/monitor-thermal.sh snapshot
```

## Integration with Existing Workflow

This app complements the existing shell-based stress tests:

```bash
# Option 1: Use the Android app for visual feedback
# Install and run the app, then monitor with scripts

# Option 2: Use shell scripts for automated testing
./scripts/stress-android.sh all
./scripts/monitor-thermal.sh monitor 10 600
```

## Troubleshooting

### App crashes on startup
- Check Android version (requires Android 7.0+)
- Verify permissions are granted
- Check logcat: `adb logcat | grep StressTest`

### Device doesn't heat up
- Increase intensity level
- Check if device is in a cold environment
- Ensure no cooling fans are directly on the device

### GPU stress not working
- Some devices restrict OpenGL ES access
- The CPU stress will still work effectively
- Try combining with shell-based GPU stress

## Safety Precautions

⚠️ **Warning**: This stress test will make your device warm!

- **Stop immediately** if device becomes uncomfortable to handle
- **Monitor battery temperature** - should stay below 45°C
- **Don't use** while charging (adds extra heat)
- **Use in well-ventilated area**
- **Remove protective cases** during testing

## Performance Impact

### Expected Thermal Throttling

| Metric | Normal | Stressed | Impact |
|--------|--------|----------|--------|
| Big Core Freq | 2.8 GHz | ~1.6 GHz | ~43% slower |
| Battery Temp | 30-35°C | 38-42°C | +8-12°C |
| Time to Throttle | N/A | 2-5 min | Varies by ambient |

## Development

### Project Structure

```
android-stress-test/
├── app/
│   ├── src/
│   │   └── main/
│   │       ├── java/com/screenferry/stresstest/
│   │       │   ├── StressTestActivity.java
│   │       │   ├── CPUStressWorker.java
│   │       │   └── GPUStressWorker.java
│   │       ├── res/
│   │       │   ├── layout/
│   │       │   │   └── activity_stress_test.xml
│   │       │   └── values/
│   │       │       └── strings.xml
│   │       └── AndroidManifest.xml
│   └── build.gradle
├── build.gradle
├── settings.gradle
└── README.md
```

### Key Classes

- **StressTestActivity**: Main UI controller
- **CPUStressWorker**: Handles CPU-intensive operations
- **GPUStressWorker**: Handles GPU-intensive operations
- **StressTestRenderer**: OpenGL ES rendering

## License

This stress test tool is part of the ScreenFerry thermal testing suite.