# Android Stress Testing Approach

## Task Summary
Set up Android stress test tooling for CPU/GPU testing on the Pixel 6 device connected via ADB.

## Chosen Approach: Open-Source DroidStress with Android SDK CLI

### Primary Tool: DroidStress
**Repository:** [TranslucentFoxHuman/DroidStress](https://github.com/TranslucentFoxHuman/DroidStress)

**Rationale:**
- Simple, focused CPU stress testing for Android devices
- Open source with clear build requirements
- Forces CPU to perform intensive calculations to generate load
- Lightweight compared to comprehensive testing suites
- Can be built with standard Android SDK tools

**Features:**
- CPU stress testing via intensive calculations
- Native Android implementation
- Suitable for thermal throttling and performance analysis

### Alternative Tools (for reference)

1. **AndroidStressTest** ([aystshen/AndroidStressTest](https://github.com/aystshen/AndroidStressTest))
   - Comprehensive system testing (CPU, memory, WiFi, Bluetooth, video)
   - More complex build requirements
   - Good for full system validation

2. **Google GPU Emulation Stress Test** ([google/gpu-emulation-stress-test](https://github.com/google/gpu-emulation-stress-test))
   - Official Google GPU stress testing
   - OpenGL ES 3.0 support
   - Focused on GPU testing

3. **OpenCL-Benchmark** ([ProjectPhysX/OpenCL-Benchmark](https://github.com/ProjectPhysX/OpenCL-Benchmark))
   - Cross-platform GPU/CPU benchmark
   - Peak performance measurement
   - Works on Android, Windows, Linux, macOS

4. **Stress-Android** ([m-ric/stress-android](https://github.com/m-ric/stress-android))
   - Port of classic Unix stress tool
   - Multi-threaded CPU and I/O pressure
   - Lightweight CLI approach

## Build Environment Setup

### Requirements
1. **Java JDK** (required for Android SDK)
   - Android development requires Java
   - Will be installed via package manager

2. **Android SDK Command Line Tools**
   - No full Android Studio IDE needed
   - Command line tools only for headless builds
   - Includes sdkmanager for package management

3. **Build Tools**
   - Android Build Tools
   - Platform SDK (Android API level matching target device)
   - Gradle (usually included with project)

### Target Device
- **Device:** Google Pixel 6
- **Connection:** ADB over Tailscale (IP: 100.88.10.113)
- **ADB Version:** 1.0.41 (version 35.0.1-android-tools)

## Implementation Plan

1. ✅ Install Java JDK
2. ✅ Download and install Android SDK command line tools
3. ✅ Configure environment variables (ANDROID_HOME, PATH)
4. ✅ Install required SDK packages via sdkmanager
5. ✅ Clone DroidStress repository
6. ✅ Build the APK using Gradle
7. ✅ Install and test on Pixel 6 via ADB

## Success Criteria

- Android SDK configured and functional
- Can build Android APKs from command line
- Stress test APK successfully builds
- APK installs and runs on Pixel 6 device
- Can generate measurable CPU load for testing

## Resources

### Installation Guides
- [How to setup Android SDK without Android Studio](https://proandroiddev.com/how-to-setup-android-sdk-without-android-studio-6d60d0f2812a)
- [Android SDK Command-line tools](https://developer.android.com/tools)

### Android Development
- [Android NDK Official Samples](https://github.com/android/ndk-samples)
- [Android Developer Documentation](https://developer.android.com/ndk)

### Stress Testing Tools
- [Awesome Android NDK](https://github.com/JsonChao/Awesome-Android-NDK)
- [ncnn-android-benchmark](https://github.com/nihui/ncnn-android-benchmark)

## Notes

- Disk space is sufficient (153GB free)
- ADB is already configured and working
- No conflicting Android Studio installation to worry about
- Can install additional tools as needed for GPU testing later
