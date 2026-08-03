# APK Output Verification (bf-33bh)

## Task Completed: ✓

Verified APK output and build artifacts for the ScreenFerry stress-test Android application.

## APK Location

**File:** `build/app/outputs/apk/debug/app-debug.apk`

## Verification Results

### 1. APK File Existence ✓
- APK file exists at expected output path
- Path: `/home/coding/screenferry/build/app/outputs/apk/debug/app-debug.apk`

### 2. File Size ✓
- **Size:** 2.9MB (3,025,385 bytes)
- **Status:** Well above 1MB minimum requirement

### 3. Build Timestamp ✓
- **Build Time:** August 2, 2026 at 21:42:07
- **Status:** Current build (today is 2026-08-02)

### 4. Build Artifacts ✓
APK contains all required components:

| Artifact | Size | Description |
|----------|------|-------------|
| classes.dex | 6.3MB | Main compiled Dalvik bytecode |
| classes2.dex | 125KB | Additional DEX file |
| classes3.dex | 13KB | Additional DEX file |
| AndroidManifest.xml | 3.7KB | App manifest |
| resources.arsc | 242KB | Compiled resources |

### 5. Build Reproducibility ✓
- **Original Checksum:** `32b2594cd44518c732b18567bbb4ba04`
- **Rebuild Checksum:** `32b2594cd44518c732b18567bbb4ba04`
- **Status:** Identical checksums - build is fully reproducible

## Build System

- **Project Type:** Native Android application
- **Build Tool:** Gradle (via gradlew in `stress-test-app/` directory)
- **Build Variant:** Debug
- **Compile SDK:** 34
- **Min SDK:** 21
- **Target SDK:** 34
- **Application ID:** com.screenferry.stresstest

## Build Output

The Gradle build system outputs to the parent directory structure:
- Source: `stress-test-app/app/src/`
- Output: `build/app/outputs/apk/debug/app-debug.apk`

## Conclusion

All acceptance criteria met:
- ✓ APK file exists and is non-zero size (2.9MB)
- ✓ Build timestamp is current (2026-08-02)
- ✓ Build artifacts present (DEX files, manifest, resources)
- ✓ Build is reproducible (identical checksums)

The Android application build pipeline is functioning correctly and producing valid, reproducible APK artifacts.
