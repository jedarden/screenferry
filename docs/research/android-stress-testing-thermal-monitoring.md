# Android Stress Testing and Thermal Monitoring Research

## Overview

This document surveys available methods for stress testing Android devices and monitoring thermal throttling, with the goal of identifying suitable approaches for the screenferry project.

## Background

**Context**: The screenferry project needs to stress test Android devices and detect thermal throttling to validate the photosensitivity safeguard mechanism. When thermal throttling occurs, frame rates can drop, potentially affecting timing accuracy.

**Goal**: Find a reliable method to both stress the device and monitor thermal state that can be integrated into testing workflows.

---

## Approaches Surveyed

### Approach 1: Android Thermal API (`getThermalHeadroom`)

**Description**: Use the official Android thermal monitoring API introduced in Android 12 (API 31).

**Key API**:
- `PowerManager.getThermalHeadroom(seconds)` - Predicts thermal headroom before throttling
- Available on API 31+ (Android 12+)
- Returns float value where 1.0 = no throttling, lower values indicate thermal constraints

**Implementation Example**:
```java
PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
float thermalHeadroom = powerManager.getThermalHeadroom(10); // 10 second prediction
Log.d("Thermal", "Headroom in 10 sec: " + thermalHeadroom);
```

**Also available**:
- `PowerManager.OnThermalHeadroomChangedListener` - Callback for thermal state changes

**Pros**:
- ✅ Official Android API - stable and documented
- ✅ No root access required
- ✅ Provides forward-looking thermal prediction
- ✅ Accurate thermal state data directly from the OS

**Cons**:
- ❌ Only available on Android 12+ (API 31+)
- ❌ Does not provide CPU frequency data directly
- ❌ Does not indicate current CPU throttling state, only prediction

**Sources**:
- [Android Thermal API Documentation](https://developer.android.com/games/optimize/adpf/thermal)
- [PowerManager API Reference](https://developer.android.com/reference/android/os/PowerManager)
- [Medium: Exploring Android PowerManager API](https://yggr.medium.com/exploring-android-powermanager-api-72981adbafb1)
- [ProAndroidDev: Thermal in Android](https://proandroiddev.com/thermal-in-android-26cc202e9d3b)

---

### Approach 2: Sysfs CPU Frequency Monitoring

**Description**: Read CPU frequency data directly from `/sys/devices/system/cpu/cpu*/cpufreq/` paths.

**Key Paths**:
- `/sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq` - Current frequency
- `/sys/devices/system/cpu/cpu*/cpufreq/scaling_max_freq` - Maximum frequency
- `/sys/devices/system/cpu/cpu*/cpufreq/scaling_min_freq` - Minimum frequency
- `/sys/devices/system/cpu/cpu*/cpufreq/stats/time_in_state` - Time per frequency

**Implementation (via ADB)**:
```bash
# Read current frequency for CPU 0
adb shell cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq

# Read all cores
adb shell cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq

# Read frequency statistics
adb shell cat /sys/devices/system/cpu/cpu0/cpufreq/stats/time_in_state
```

**Pros**:
- ✅ Provides detailed per-core CPU frequency data
- ✅ Shows current throttling state directly via frequency values
- ✅ Includes statistics (time spent at each frequency)
- ✅ Works on older Android versions

**Cons**:
- ❌ Requires root access on most production devices
- ❌ File paths can vary between devices/Android versions
- ❌ Fragile - sysfs interfaces are not stable APIs
- ❌ No direct thermal temperature data

**Sources**:
- [StackOverflow: CpuFreq on Android](https://stackoverflow.com/questions/11124538/cpufreq-on-android)
- [Perfetto Linux sys_stats documentation](https://google.github.io/perfetto/linux-sys-stats.html)

---

### Approach 3: Existing Benchmark/Stress Applications

**Description**: Use pre-built Android applications for stress testing and thermal monitoring.

**Available Tools**:

1. **CPU Throttling Test** ([Google Play](https://play.google.com/store/apps/details?id=com.texts.throttlebench))
   - Specialized for thermal throttling detection
   - Tracks max/min/avg GIPS (Giga Instructions Per Second)
   - Recommended 20-minute test duration
   - Shows sustained performance degradation

2. **CPU GPU Stress Test Benchmark** ([Google Play](https://play.google.com/store/apps/details?id=com.AIDatskoStudio.CPU.GPU.Performance.test))
   - Independent CPU and GPU stress testing
   - Built-in thermal protection and emergency stop
   - Identifies lags and performance drops

3. **Geekbench**
   - CPU performance benchmarking
   - Can reveal thermal throttling over multiple runs
   - Widely used for comparison

4. **3DMark**
   - GPU-focused stress testing
   - Measures real-world CPU scaling and thermal throttling
   - Stress tests reveal sustained performance patterns

**Pros**:
- ✅ No development required
- ✅ Easy to use
- ✅ Often include visualization and analysis
- ✅ No root required

**Cons**:
- ❌ Not programmatically controllable
- ❌ Limited data export options
- ❌ UI-dependent - cannot be automated easily
- ❌ Benchmark detection spoofing (some devices cheat)

**Sources**:
- [CPU Throttling Test - Google Play](https://play.google.com/store/apps/details?id=com.texts.throttlebench)
- [CPU GPU Stress Test Benchmark - Google Play](https://play.google.com/store/apps/details?id=com.AIDatskoStudio.CPU.GPU.Performance.test)

---

### Approach 4: ADB-Based Stress Testing

**Description**: Generate CPU load via ADB commands and monitor system state through shell tools.

**Stress Generation Methods**:

1. **Monkey Tool** (UI Stress Testing):
```bash
adb shell monkey -p com.example.app --throttle 100 --pct-motion 50 50000
```

2. **Custom CPU Load** (requires app or shell):
```bash
# Spawn multiple threads to load CPU
adb shell sh -c 'for i in $(seq 1 $(nproc)); do sha1sum /dev/zero & done'
```

3. **CPU Usage Monitoring**:
```bash
# Monitor CPU usage with top
adb shell top | grep cpu

# Dump CPU stats
adb shell cat /proc/stat
```

**Pros**:
- ✅ No app development needed
- ✅ Scriptable and automatable
- ✅ Works on any device with ADB access

**Cons**:
- ❌ Thermal API not accessible via ADB
- ❌ CPU frequency monitoring requires root
- ❌ Indirect detection of thermal throttling (via performance degradation)
- ❌ Higher sampling latency than in-app monitoring

**Sources**:
- [Medium: Using ADB to View Device CPU Usage](https://medium.com/@lee645521797/android-using-adb-to-view-device-cpu-usage-and-analyze-performance-data-ededcd60d6a0)
- [GitHub: ADB Cheatsheet](https://github.com/OutrageousStorm/android-adb-cheatsheet/blob/main/advanced-commands.md)
- [Tricentis: Useful ADB Commands for Android Testing](https://www.tricentis.com/learn/useful-adb-commands-for-android-testing)
- [InfoHeap: Exerciser Monkey Tool](https://infoheap.com/use-exerciser-monkey-for-android-stress-testing/)
- [Reddit: ADB Shell CPU Load](https://www.reddit.com/r/androiddev/comments/1gemyc8/any_adb_shell_command_to_increase_cpu_loadusage/)

---

## Comparison Summary

| Approach | API Level | Root Required | Programmable | Direct Thermal | CPU Frequency |
|----------|-----------|---------------|--------------|----------------|----------------|
| 1. Thermal API | 31+ | No | ✅ Yes | ✅ Yes | ❌ No |
| 2. Sysfs CPU Freq | Any | Yes* | ✅ Yes | ❌ No | ✅ Yes |
| 3. Existing Apps | Any | No | ❌ No | ⚠️ Limited | ⚠️ Limited |
| 4. ADB Scripts | Any | No* | ✅ Yes | ❌ No | ⚠️ Root only |

*Root required for sysfs on most devices. Some basic monitoring via ADB without root.

---

## Recommendation

### Primary Recommendation: Approach 1 (Thermal API)

**Recommended for screenferry**: Use the Android Thermal API (`getThermalHeadroom`) with a companion stress generation app.

**Justification**:
1. **API Availability**: The project's target device (Pixel 6) runs Android 12+, fully supporting the Thermal API
2. **No Root Required**: Works on production devices without modification
3. **Stable API**: Official Android API - won't break with OS updates
4. **Sufficient Data**: Thermal headroom prediction is adequate to detect when the device is approaching throttling
5. **Integration**: Can be integrated into the existing screenferry app or a separate testing module

**Implementation Strategy**:
- Create a lightweight stress test module that loads CPU/GPU
- Monitor `getThermalHeadroom()` during stress
- Log thermal state and performance metrics
- Detect when thermal headroom drops below threshold

### Secondary/Complementary Approach: Approach 4 (ADB Scripts)

**For automated testing workflows**: Use ADB-based stress testing when app-level integration isn't feasible.

**When to use**:
- CI/CD environments where app installation is impractical
- Quick one-off stress tests without building a dedicated app
- Testing on devices where the thermal API is unavailable

**Combined Approach**: Use Thermal API for detailed monitoring and ADB scripts for generating consistent load profiles.

---

## Next Steps

1. **Implement Thermal API Monitor**
   - Create a module that polls `getThermalHeadroom()` at regular intervals
   - Log thermal state alongside performance metrics
   - Implement threshold-based alerting

2. **Develop Stress Test Generator**
   - Create CPU load generation (mathematical operations, compression)
   - Create GPU load generation (rendering operations)
   - Ensure sustained load to trigger thermal throttling

3. **Integration with Photosensitivity Safeguard**
   - Use thermal monitoring to validate frame rate consistency
   - Correlate thermal throttling events with timing accuracy
   - Document expected behavior under thermal stress

4. **Validation**
   - Run stress tests on target device (Pixel 6)
   - Confirm thermal API reports expected values
   - Verify that throttling detection works as intended

---

## Notes

- **Benchmark Spoofing**: Some devices detect benchmark apps and disable thermal throttling. The Android Thermal API is less susceptible to this than third-party apps.
- **Device Variability**: Different devices have different thermal characteristics. Testing should be done on the target device family.
- **Test Duration**: Thermal throttling typically takes several minutes to manifest. Recommended minimum test duration is 15-20 minutes.

---

## Document Metadata

**Date**: 2026-08-02
**Bead**: bf-4w6o
**Workspace**: screenferry
**Purpose**: Research for thermal throttling validation of photosensitivity safeguards

---

## Sources

- [Android Thermal API Documentation](https://developer.android.com/games/optimize/adpf/thermal)
- [PowerManager API Reference](https://developer.android.com/reference/android/os/PowerManager)
- [Medium: Exploring Android PowerManager API](https://yggr.medium.com/exploring-android-powermanager-api-72981adbafb1)
- [ProAndroidDev: Thermal in Android](https://proandroiddev.com/thermal-in-android-26cc202e9d3b)
- [StackOverflow: CpuFreq on Android](https://stackoverflow.com/questions/11124538/cpufreq-on-android)
- [CPU Throttling Test - Google Play](https://play.google.com/store/apps/details?id=com.texts.throttlebench)
- [CPU GPU Stress Test Benchmark - Google Play](https://play.google.com/store/apps/details?id=com.AIDatskoStudio.CPU.GPU.Performance.test)
- [Medium: Using ADB to View Device CPU Usage](https://medium.com/@lee645521797/android-using-adb-to-view-device-cpu-usage-and-analyze-performance-data-ededcd60d6a0)
- [GitHub: ADB Cheatsheet](https://github.com/OutrageousStorm/android-adb-cheatsheet/blob/main/advanced-commands.md)
- [Tricentis: Useful ADB Commands for Android Testing](https://www.tricentis.com/learn/useful-adb-commands-for-android-testing)
- [InfoHeap: Exerciser Monkey Tool](https://infoheap.com/use-exerciser-monkey-for-android-stress-testing/)
- [Reddit: ADB Shell CPU Load](https://www.reddit.com/r/androiddev/comments/1gemyc8/any_adb_shell_command_to_increase_cpu_loadusage/)
