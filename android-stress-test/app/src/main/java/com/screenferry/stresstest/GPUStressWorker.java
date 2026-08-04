package com.screenferry.stresstest;

import android.content.Context;
import android.opengl.GLSurfaceView;
import android.view.WindowManager;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.Random;

/**
 * GPU Stress Worker
 * Performs intensive OpenGL ES rendering operations to stress the GPU
 */
public class GPUStressWorker implements Runnable {

    private final Context context;
    private final int intensity;
    private final AtomicBoolean running = new AtomicBoolean(true);
    private final AtomicLong framesRendered = new AtomicLong(0);
    private final Random random = new Random();

    private GLSurfaceView glSurfaceView;
    private StressTestRenderer renderer;
    private WindowManager windowManager;

    public GPUStressWorker(Context context, int intensity) {
        this.context = context;
        this.intensity = intensity;
    }

    @Override
    public void run() {
        running.set(true);

        // Create GLSurfaceView for actual GPU rendering
        try {
            glSurfaceView = new GLSurfaceView(context);
            renderer = new StressTestRenderer(intensity);
            glSurfaceView.setRenderer(renderer);
            glSurfaceView.setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);

            // Create and add the view to the window
            windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
            WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                1, 1, // Minimal size - we just want GPU load, not visibility
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE |
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                android.graphics.PixelFormat.TRANSLUCENT
            );

            windowManager.addView(glSurfaceView, params);

            // Wait until stopped
            while (running.get()) {
                try {
                    Thread.sleep(100);
                } catch (InterruptedException e) {
                    break;
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            cleanup();
        }
    }

    /**
     * Generates random vertex data for processing
     */
    private float[] generateVertices(int count) {
        float[] vertices = new float[count * 3]; // x, y, z for each vertex

        for (int i = 0; i < vertices.length; i++) {
            vertices[i] = random.nextFloat() * 2.0f - 1.0f; // Range: -1.0 to 1.0
        }

        return vertices;
    }

    /**
     * Simulates vertex transformation operations
     */
    private float[] transformVertices(float[] vertices) {
        float[] transformed = new float[vertices.length];

        // Transformation matrix
        float[] matrix = {
            1.0f, 0.0f, 0.0f, 0.0f,
            0.0f, 1.0f, 0.0f, 0.0f,
            0.0f, 0.0f, 1.0f, 0.0f,
            0.0f, 0.0f, 0.0f, 1.0f
        };

        // Apply transformation to each vertex
        for (int i = 0; i < vertices.length; i += 3) {
            float x = vertices[i];
            float y = vertices[i + 1];
            float z = vertices[i + 2];

            // Matrix multiplication (simplified)
            transformed[i] = x * matrix[0] + y * matrix[1] + z * matrix[2];
            transformed[i + 1] = x * matrix[4] + y * matrix[5] + z * matrix[6];
            transformed[i + 2] = x * matrix[8] + y * matrix[9] + z * matrix[10];
        }

        return transformed;
    }

    /**
     * Simulates pixel shading operations
     */
    private int[] simulatePixelShading(int pixelCount) {
        int[] colors = new int[pixelCount * 4]; // RGBA for each pixel

        for (int i = 0; i < colors.length; i += 4) {
            // Simulate lighting calculations
            float r = random.nextFloat();
            float g = random.nextFloat();
            float b = random.nextFloat();

            // Apply intensity-based lighting
            float lightIntensity = 0.5f + (intensity / 20.0f);

            colors[i] = (int) (r * 255 * lightIntensity);     // R
            colors[i + 1] = (int) (g * 255 * lightIntensity); // G
            colors[i + 2] = (int) (b * 255 * lightIntensity); // B
            colors[i + 3] = 255;                               // A (alpha)
        }

        return colors;
    }

    /**
     * Simulates texture mapping operations
     */
    private int[] simulateTextureOperations(int size) {
        int[] textureData = new int[size * size * 4]; // RGBA for each texel

        // Generate texture data
        for (int i = 0; i < textureData.length; i += 4) {
            // Create procedural texture pattern based on intensity
            float frequency = intensity * 0.1f;

            textureData[i] = (int) (Math.sin(frequency) * 127 + 128);     // R
            textureData[i + 1] = (int) (Math.cos(frequency) * 127 + 128); // G
            textureData[i + 2] = (int) (Math.sin(frequency * 2) * 127 + 128); // B
            textureData[i + 3] = 255;                                      // A
        }

        // Simulate texture filtering operations
        int[] filteredData = new int[textureData.length];
        for (int i = 0; i < textureData.length; i += 4) {
            // Bilinear filtering simulation
            filteredData[i] = (textureData[i] + textureData[i + 4]) / 2;
            filteredData[i + 1] = (textureData[i + 1] + textureData[i + 5]) / 2;
            filteredData[i + 2] = (textureData[i + 2] + textureData[i + 6]) / 2;
            filteredData[i + 3] = 255;
        }

        return filteredData;
    }

    /**
     * Cleanup resources
     */
    private void cleanup() {
        if (windowManager != null && glSurfaceView != null) {
            try {
                windowManager.removeView(glSurfaceView);
            } catch (Exception e) {
                // View already removed
            }
        }

        if (glSurfaceView != null) {
            glSurfaceView.onPause();
        }
    }

    /**
     * Stops the worker
     */
    public void stop() {
        running.set(false);
        cleanup();
    }

    /**
     * Gets the number of frames rendered
     */
    public long getFramesRendered() {
        if (renderer != null) {
            return renderer.getFrameCount();
        }
        return framesRendered.get();
    }

    public boolean isRunning() {
        return running.get();
    }
}

/**
 * Custom GLSurfaceView renderer for GPU stress testing
 */
class StressTestRenderer implements GLSurfaceView.Renderer {

    private final int intensity;
    private final Random random = new Random();
    private long frameCount = 0;

    public StressTestRenderer(int intensity) {
        this.intensity = intensity;
    }

    public long getFrameCount() {
        return frameCount;
    }

    @Override
    public void onSurfaceCreated(GL10 gl, EGLConfig config) {
        // Set up basic OpenGL state
        gl.glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
        gl.glDisable(GL10.GL_DITHER);
        gl.glDisable(GL10.GL_DEPTH_TEST);
    }

    @Override
    public void onSurfaceChanged(GL10 gl, int width, int height) {
        gl.glViewport(0, 0, width, height);
    }

    @Override
    public void onDrawFrame(GL10 gl) {
        // Clear screen with random color to force GPU work
        float r = random.nextFloat();
        float g = random.nextFloat();
        float b = random.nextFloat();
        gl.glClearColor(r, g, b, 1.0f);
        gl.glClear(GL10.GL_COLOR_BUFFER_BIT | GL10.GL_DEPTH_BUFFER_BIT);

        // Draw multiple overlapping quads based on intensity
        int quadCount = 1 + intensity;
        for (int i = 0; i < quadCount; i++) {
            drawQuad(gl, i);
        }

        frameCount++;
    }

    /**
     * Draws a colored quad
     */
    private void drawQuad(GL10 gl, int index) {
        gl.glColor4f(random.nextFloat(), random.nextFloat(), random.nextFloat(), 1.0f);

        float offset = (float) index / 10.0f;

        gl.glPushMatrix();
        gl.glTranslatef(offset, offset, 0.0f);
        gl.glRotatef(frameCount + (index * 10), 0, 0, 1);
        gl.glScalef(0.8f, 0.8f, 1.0f);

        // Draw quad
        gl.glBegin(GL10.GL_TRIANGLE_STRIP);
        gl.glVertex2f(-0.5f, -0.5f);
        gl.glVertex2f(0.5f, -0.5f);
        gl.glVertex2f(-0.5f, 0.5f);
        gl.glVertex2f(0.5f, 0.5f);
        gl.glEnd();

        gl.glPopMatrix();
    }
}