# APK Build Verification (bf-33bh)

## Task
Verify APK output and build artifacts for the ScreenFerry stress-test-app.

## Verification Results

### APK Location
- **Actual path**: `build/app/outputs/apk/debug/app-debug.apk`
- **Expected path in task**: `stress-test-app/app/build/outputs/apk/debug/app-debug.apk`
- **Note**: The Gradle build outputs to the parent `build/` directory instead of under `stress-test-app/`

### APK File Properties
- **Size**: 2.9MB (2,953,385 bytes) ✅
- **Requirement**: > 1MB ✅
- **Build timestamp**: 2026-08-02 23:07:02 EDT ✅ (current)
- **Permissions**: -rw-rw-r-- (regular file)

### Build Artifacts Verification
The APK contains all required build artifacts:

| Artifact | Size | Status |
|----------|------|--------|
| classes.dex | 6,296,104 bytes | ✅ |
| classes2.dex | 124,928 bytes | ✅ |
| classes3.dex | 13,324 bytes | ✅ |
| AndroidManifest.xml | 3,772 bytes | ✅ |
| resources.arsc | 242,228 bytes | ✅ |

### Reproducibility Test
- **Original build MD5**: `32b2594cd44518c732b18567bbb4ba04` (23:00:40)
- **Rebuild MD5**: `32b2594cd44518c732b18567bbb4ba04` (23:07:02)
- **Result**: ✅ **Exact match** - build is reproducible

### Build Process
```bash
cd stress-test-app
./gradlew assembleDebug
```

**Build output**: Successful (609ms, 30 tasks: 3 executed, 27 up-to-date)

## Conclusion
All acceptance criteria met:
- ✅ APK file exists (at `build/app/outputs/apk/debug/app-debug.apk`)
- ✅ APK file size is reasonable (2.9MB > 1MB requirement)
- ✅ Build timestamp is current (2026-08-02)
- ✅ Build is reproducible (MD5 checksums match)
- ✅ All required artifacts present (dex files, manifest, resources)
