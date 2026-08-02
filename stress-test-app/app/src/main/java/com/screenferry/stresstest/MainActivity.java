package com.screenferry.stresstest;

import android.app.Activity;
import android.content.Context;
import android.opengl.GLSurfaceView;
import android.os.Bundle;
import android.os.PowerManager;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final String TAG = "StressTest";

    private PowerManager.WakeLock wakeLock;
    private GLSurfaceView glView;
    private TextView statusText;
    private Button startButton, stopButton;
    private Button[] intensityButtons = new Button[3];

    private StressLevel currentStressLevel = StressLevel.MEDIUM;
    private boolean isRunning = false;

    private List<CpuStressThread> cpuThreads = new ArrayList<>();
    private List<GLSurfaceView> gpuViews = new ArrayList<>();
    private LinearLayout gpuContainer;

    private enum StressLevel {
        LOW(2, 1, "Low - 2 CPU cores, 1 GPU"),
        MEDIUM(4, 2, "Medium - 4 CPU cores, 2 GPU"),
        HIGH(8, 4, "High - 8 CPU cores, 4 GPU");

        final int cpuCores;
        final int gpuInstances;
        final String description;

        StressLevel(int cpuCores, int gpuInstances, String description) {
            this.cpuCores = cpuCores;
            this.gpuInstances = gpuInstances;
            this.description = description;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Setup main layout
        LinearLayout mainLayout = new LinearLayout(this);
        mainLayout.setOrientation(LinearLayout.VERTICAL);
        mainLayout.setPadding(32, 32, 32, 32);
        mainLayout.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // Title
        TextView titleText = new TextView(this);
        titleText.setText("Android Stress Test");
        titleText.setTextSize(24);
        titleText.setPadding(0, 0, 0, 16);
        mainLayout.addView(titleText);

        // Status text
        statusText = new TextView(this);
        statusText.setText("Status: Ready\nIntensity: Medium");
        statusText.setTextSize(16);
        statusText.setPadding(0, 0, 0, 16);
        mainLayout.addView(statusText);

        // Intensity selection
        TextView intensityLabel = new TextView(this);
        intensityLabel.setText("Select Intensity:");
        intensityLabel.setTextSize(14);
        intensityLabel.setPadding(0, 0, 0, 8);
        mainLayout.addView(intensityLabel);

        LinearLayout intensityLayout = new LinearLayout(this);
        intensityLayout.setOrientation(LinearLayout.HORIZONTAL);

        String[] intensityNames = {"Low", "Medium", "High"};
        StressLevel[] levels = {StressLevel.LOW, StressLevel.MEDIUM, StressLevel.HIGH};

        for (int i = 0; i < 3; i++) {
            final int index = i;
            intensityButtons[i] = new Button(this);
            intensityButtons[i].setText(intensityNames[i]);
            intensityButtons[i].setLayoutParams(new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f
            ));
            intensityButtons[i].setOnClickListener(v -> setIntensity(levels[index]));
            intensityLayout.addView(intensityButtons[i]);
        }

        mainLayout.addView(intensityLayout);

        // Control buttons
        LinearLayout controlLayout = new LinearLayout(this);
        controlLayout.setOrientation(LinearLayout.HORIZONTAL);
        controlLayout.setPadding(0, 16, 0, 0);

        startButton = new Button(this);
        startButton.setText("Start");
        startButton.setLayoutParams(new LinearLayout.LayoutParams(
            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f
        ));
        startButton.setOnClickListener(v -> startStressTest());

        stopButton = new Button(this);
        stopButton.setText("Stop");
        stopButton.setEnabled(false);
        stopButton.setLayoutParams(new LinearLayout.LayoutParams(
            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f
        ));
        stopButton.setOnClickListener(v -> stopStressTest());

        controlLayout.addView(startButton);
        controlLayout.addView(stopButton);
        mainLayout.addView(controlLayout);

        // GPU container (hidden, used for rendering)
        gpuContainer = new LinearLayout(this);
        gpuContainer.setOrientation(LinearLayout.VERTICAL);
        gpuContainer.setVisibility(View.GONE);
        mainLayout.addView(gpuContainer);

        // Info text
        TextView infoText = new TextView(this);
        infoText.setText("\nInfo:\n- Low: 2 CPU cores + 1 GPU\n- Medium: 4 CPU cores + 2 GPUs\n- High: 8 CPU cores + 4 GPUs");
        infoText.setTextSize(12);
        mainLayout.addView(infoText);

        setContentView(mainLayout);

        // Initialize wake lock
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(
            PowerManager.FULL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
            "StressTest:WakeLock"
        );

        // Set default intensity
        setIntensity(StressLevel.MEDIUM);
    }

    private void setIntensity(StressLevel level) {
        currentStressLevel = level;

        // Update button appearances
        for (int i = 0; i < 3; i++) {
            intensityButtons[i].setAlpha(0.5f);
        }

        int selected = 0;
        switch (level) {
            case LOW: selected = 0; break;
            case MEDIUM: selected = 1; break;
            case HIGH: selected = 2; break;
        }
        intensityButtons[selected].setAlpha(1.0f);

        if (!isRunning) {
            statusText.setText("Status: Ready\nIntensity: " + level.description);
        }
    }

    private void startStressTest() {
        if (isRunning) return;

        isRunning = true;
        startButton.setEnabled(false);
        stopButton.setEnabled(true);

        // Acquire wake lock to keep device awake
        try {
            wakeLock.acquire();
        } catch (Exception e) {
            // Wake lock acquisition failed, continue anyway
        }

        // Start CPU stress threads
        int cpuCount = currentStressLevel.cpuCores;
        for (int i = 0; i < cpuCount; i++) {
            CpuStressThread thread = new CpuStressThread();
            thread.start();
            cpuThreads.add(thread);
        }

        // Start GPU stress by adding GLSurfaceViews
        int gpuCount = currentStressLevel.gpuInstances;
        gpuContainer.setVisibility(View.VISIBLE);
        for (int i = 0; i < gpuCount; i++) {
            GpuStressView gpuView = new GpuStressView(this);
            gpuViews.add(gpuView);
            // Add to container to actually attach to window and render
            gpuContainer.addView(gpuView, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                200  // Each GPU view gets 200px height
            ));
            gpuView.onResume();  // Start rendering
        }

        statusText.setText("Status: RUNNING\nIntensity: " + currentStressLevel.description +
            "\n\nCPU threads: " + cpuCount + "\nGPU instances: " + gpuCount);
    }

    private void stopStressTest() {
        if (!isRunning) return;

        isRunning = false;
        startButton.setEnabled(true);
        stopButton.setEnabled(false);

        // Stop CPU threads
        for (CpuStressThread thread : cpuThreads) {
            thread.stopRunning();
        }
        cpuThreads.clear();

        // Stop GPU views
        for (GLSurfaceView view : gpuViews) {
            view.onPause();
            ((GpuStressView) view).cleanup();
            gpuContainer.removeView(view);
        }
        gpuViews.clear();
        gpuContainer.setVisibility(View.GONE);

        // Release wake lock
        try {
            if (wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception e) {
            // Wake lock release failed
        }

        statusText.setText("Status: Stopped\nIntensity: " + currentStressLevel.description);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopStressTest();
    }

    // CPU Stress Thread
    private static class CpuStressThread extends Thread {
        private volatile boolean running = true;

        public void run() {
            // CPU-intensive computation
            while (running) {
                // Mathematical operations to keep CPU busy
                double result = 0;
                for (int i = 0; i < 1000000; i++) {
                    result += Math.sin(i) * Math.cos(i);
                    result += Math.sqrt(Math.abs(result) + 1);
                }

                // Small sleep to prevent complete freezing
                try {
                    Thread.sleep(1);
                } catch (InterruptedException e) {
                    break;
                }
            }
        }

        public void stopRunning() {
            running = false;
            interrupt();
        }
    }

    // GPU Stress View
    private static class GpuStressView extends GLSurfaceView {
        public GpuStressView(Context context) {
            super(context);
            setEGLContextClientVersion(2);
            setRenderer(new GpuStressRenderer());
            setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
        }

        public void cleanup() {
            setRenderMode(GLSurfaceView.RENDERMODE_WHEN_DIRTY);
        }
    }

    // GPU Stress Renderer
    private static class GpuStressRenderer implements GLSurfaceView.Renderer {
        private float angle = 0;
        private float[] vertices;
        private float[] colors;

        public GpuStressRenderer() {
            // Create a complex mesh (icosahedron-ish with many vertices)
            int numVertices = 1000;
            vertices = new float[numVertices * 3];
            colors = new float[numVertices * 4];

            for (int i = 0; i < numVertices; i++) {
                float theta = (float) (i * 2.0 * Math.PI / numVertices);
                float phi = (float) (i * Math.PI / numVertices);
                vertices[i * 3] = (float) (Math.cos(theta) * Math.sin(phi));
                vertices[i * 3 + 1] = (float) (Math.sin(theta) * Math.sin(phi));
                vertices[i * 3 + 2] = (float) Math.cos(phi);

                colors[i * 4] = 0.5f + 0.5f * (float) Math.sin(theta);
                colors[i * 4 + 1] = 0.5f + 0.5f * (float) Math.cos(phi);
                colors[i * 4 + 2] = 0.5f + 0.5f * (float) Math.sin(theta + phi);
                colors[i * 4 + 3] = 1.0f;
            }
        }

        @Override
        public void onSurfaceCreated(GL10 gl, EGLConfig config) {
            gl.glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
            gl.glEnable(GL10.GL_DEPTH_TEST);
            gl.glShadeModel(GL10.GL_SMOOTH);
        }

        @Override
        public void onSurfaceChanged(GL10 gl, int width, int height) {
            gl.glViewport(0, 0, width, height);
            gl.glMatrixMode(GL10.GL_PROJECTION);
            gl.glLoadIdentity();
            float ratio = (float) width / height;
            gl.glFrustumf(-ratio, ratio, -1, 1, 1, 100);
        }

        @Override
        public void onDrawFrame(GL10 gl) {
            // Continuous intensive rendering to stress GPU
            gl.glClear(GL10.GL_COLOR_BUFFER_BIT | GL10.GL_DEPTH_BUFFER_BIT);
            gl.glMatrixMode(GL10.GL_MODELVIEW);
            gl.glLoadIdentity();
            gl.glTranslatef(0, 0, -5);

            // Draw multiple rotated copies of the mesh
            for (int copy = 0; copy < 5; copy++) {
                gl.glPushMatrix();
                gl.glRotatef(angle + copy * 72, 1, 1, 1);
                gl.glRotatef(angle * 0.5f + copy * 36, 0, 1, 0);

                // Draw vertices as points for maximum GPU throughput
                gl.glEnableClientState(GL10.GL_VERTEX_ARRAY);
                gl.glVertexPointer(3, GL10.GL_FLOAT, 0, createFloatBuffer(vertices));

                gl.glEnableClientState(GL10.GL_COLOR_ARRAY);
                gl.glColorPointer(4, GL10.GL_FLOAT, 0, createFloatBuffer(colors));

                gl.glDrawArrays(GL10.GL_POINTS, 0, vertices.length / 3);

                gl.glDisableClientState(GL10.GL_VERTEX_ARRAY);
                gl.glDisableClientState(GL10.GL_COLOR_ARRAY);

                gl.glPopMatrix();
            }

            angle += 2.0f;
            if (angle > 360) angle = 0;
        }

        private FloatBuffer createFloatBuffer(float[] array) {
            ByteBuffer bb = ByteBuffer.allocateDirect(array.length * 4);
            bb.order(ByteOrder.nativeOrder());
            FloatBuffer fb = bb.asFloatBuffer();
            fb.put(array);
            fb.position(0);
            return fb;
        }
    }
}
