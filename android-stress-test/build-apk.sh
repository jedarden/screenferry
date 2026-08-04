#!/bin/bash
# Build script for Android Stress Test APK

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}"
GRADLE_WRAPPER="./gradlew"

# Color output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

echo "========================================"
echo "Android Stress Test APK Builder"
echo "========================================"
echo ""

# Check prerequisites
log_info "Checking prerequisites..."

if [ ! -d "$ANDROID_SDK_ROOT" ]; then
    log_error "Android SDK not found at $ANDROID_SDK_ROOT"
    log_info "Please install Android SDK or set ANDROID_SDK_ROOT environment variable"
    exit 1
fi

if [ ! -f "$GRADLE_WRAPPER" ]; then
    log_info "Gradle wrapper not found. Creating one..."
    # Try to use system gradle to create wrapper
    if command -v gradle &> /dev/null; then
        gradle wrapper
    else
        log_error "Gradle not found. Please install Gradle or Android Studio"
        exit 1
    fi
fi

log_success "Prerequisites check passed"
echo ""

# Build the APK
log_info "Building debug APK..."
log_info "This may take several minutes on first build..."

if [ -f "$GRADLE_WRAPPER" ]; then
    chmod +x "$GRADLE_WRAPPER"
    "$GRADLE_WRAPPER" clean assembleDebug
else
    gradle clean assembleDebug
fi

if [ $? -eq 0 ]; then
    log_success "✓ APK built successfully!"
    echo ""
    log_info "APK location: app/build/outputs/apk/debug/app-debug.apk"
    log_info "File size: $(du -h app/build/outputs/apk/debug/app-debug.apk | cut -f1)"
    echo ""
    log_info "To install on device:"
    log_info "  adb install -r app/build/outputs/apk/debug/app-debug.apk"
    echo ""
    log_info "To launch the app:"
    log_info "  adb shell am start -n com.screenferry.stresstest/.StressTestActivity"
else
    log_error "✗ APK build failed"
    exit 1
fi