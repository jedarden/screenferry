# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.

# Keep stress test classes
-keep class com.screenferry.stresstest.** { *; }

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep OpenGL ES related classes
-keep class javax.microedition.khronos.** { *; }
-keep class android.opengl.** { *; }