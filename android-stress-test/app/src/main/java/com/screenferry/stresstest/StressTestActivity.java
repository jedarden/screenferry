package com.screenferry.stresstest;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.PowerManager;
import android.view.View;
import android.widget.Button;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;
import android.os.Handler;
import android.os.Looper;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class StressTestActivity extends Activity {

    // Preferences keys
    private static final String PREFS_NAME = "StressTestPrefs";
    private static final String KEY_INTENSITY = "intensity";

    // UI Components
    private TextView tvCpuStatus;
    private TextView tvGpuStatus;
    private TextView tvIntensityLevel;
    private TextView tvRunningTime;
    private SeekBar seekBarIntensity;
    private Button btnStartStop;
    private Button btnLowIntensity;
    private Button btnMediumIntensity;
    private Button btnHighIntensity;

    // Stress test control
    private AtomicBoolean isRunning = new AtomicBoolean(false);
    private ExecutorService executor;
    private PowerManager.WakeLock wakeLock;
    private Handler handler;

    // Stress test workers
    private CPUStressWorker[] cpuWorkers;
    private GPUStressWorker gpuWorker;

    // Statistics
    private long startTime;
    private Runnable updateRunnable;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_stress_test);

        // Load saved intensity
        int savedIntensity = loadIntensity();

        // Initialize UI
        initUI();

        // Restore intensity setting
        seekBarIntensity.setProgress(savedIntensity);
        updateIntensityDisplay(savedIntensity);

        // Initialize handler for UI updates
        handler = new Handler(Looper.getMainLooper());

        // Get wake lock
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(
            PowerManager.SCREEN_DIM_WAKE_LOCK,
            "StressTest:KeepScreenOn"
        );
    }

    private void initUI() {
        tvCpuStatus = findViewById(R.id.tvCpuStatus);
        tvGpuStatus = findViewById(R.id.tvGpuStatus);
        tvIntensityLevel = findViewById(R.id.tvIntensityLevel);
        tvRunningTime = findViewById(R.id.tvRunningTime);
        seekBarIntensity = findViewById(R.id.seekBarIntensity);
        btnStartStop = findViewById(R.id.btnStartStop);
        btnLowIntensity = findViewById(R.id.btnLowIntensity);
        btnMediumIntensity = findViewById(R.id.btnMediumIntensity);
        btnHighIntensity = findViewById(R.id.btnHighIntensity);

        // Setup intensity seek bar
        seekBarIntensity.setMax(10);
        seekBarIntensity.setProgress(5);
        seekBarIntensity.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                updateIntensityDisplay(progress);
                // Save intensity when user changes it
                if (fromUser) {
                    saveIntensity(progress);
                }
            }

            @Override
            public void onStartTrackingTouch(SeekBar seekBar) {}

            @Override
            public void onStopTrackingTouch(SeekBar seekBar) {}
        });

        // Setup preset intensity buttons
        btnLowIntensity.setOnClickListener(v -> setIntensity(3));   // Low
        btnMediumIntensity.setOnClickListener(v -> setIntensity(5));  // Medium
        btnHighIntensity.setOnClickListener(v -> setIntensity(8));    // High

        // Setup start/stop button
        btnStartStop.setOnClickListener(v -> toggleStressTest());
    }

    private void setIntensity(int intensity) {
        seekBarIntensity.setProgress(intensity);
        saveIntensity(intensity);
        updateIntensityDisplay(intensity);
    }

    private void updateIntensityDisplay(int intensity) {
        String intensityText = "Intensity: " + intensity + "/10";
        if (intensity <= 3) {
            intensityText += " (Low)";
        } else if (intensity <= 7) {
            intensityText += " (Medium)";
        } else {
            intensityText += " (High)";
        }
        tvIntensityLevel.setText(intensityText);
    }

    private void toggleStressTest() {
        if (isRunning.get()) {
            stopStressTest();
        } else {
            startStressTest();
        }
    }

    private void startStressTest() {
        int intensity = seekBarIntensity.getProgress();
        int numThreads = intensity + 1; // 1-11 threads

        isRunning.set(true);
        btnStartStop.setText("Stop Stress Test");
        btnStartStop.setBackgroundColor(0xFFCC0000); // Red

        // Acquire wake lock to keep device awake
        wakeLock.acquire();

        // Initialize executor
        executor = Executors.newFixedThreadPool(numThreads + 1); // +1 for GPU

        // Start CPU stress workers
        cpuWorkers = new CPUStressWorker[numThreads];
        for (int i = 0; i < numThreads; i++) {
            cpuWorkers[i] = new CPUStressWorker(intensity);
            executor.submit(cpuWorkers[i]);
        }

        // Start GPU stress worker
        gpuWorker = new GPUStressWorker(this, intensity);
        executor.submit(gpuWorker);

        // Update status
        tvCpuStatus.setText("CPU Stress: " + numThreads + " threads running");
        tvGpuStatus.setText("GPU Stress: Rendering");

        // Start timer
        startTime = System.currentTimeMillis();
        updateRunningTime();

        Toast.makeText(this, "Stress test started with intensity " + intensity, Toast.LENGTH_SHORT).show();
    }

    private void stopStressTest() {
        isRunning.set(false);
        btnStartStop.setText("Start Stress Test");
        btnStartStop.setBackgroundColor(0xFF4CAF50); // Green

        // Stop CPU workers
        if (cpuWorkers != null) {
            for (CPUStressWorker worker : cpuWorkers) {
                if (worker != null) {
                    worker.stop();
                }
            }
        }

        // Stop GPU worker
        if (gpuWorker != null) {
            gpuWorker.stop();
        }

        // Shutdown executor
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }

        // Release wake lock
        if (wakeLock.isHeld()) {
            wakeLock.release();
        }

        // Update status
        tvCpuStatus.setText("CPU Stress: Stopped");
        tvGpuStatus.setText("GPU Stress: Stopped");

        // Stop timer
        handler.removeCallbacks(updateRunnable);

        Toast.makeText(this, "Stress test stopped", Toast.LENGTH_SHORT).show();
    }

    private void updateRunningTime() {
        updateRunnable = new Runnable() {
            @Override
            public void run() {
                if (isRunning.get()) {
                    long elapsed = System.currentTimeMillis() - startTime;
                    long seconds = elapsed / 1000;
                    long minutes = seconds / 60;
                    long remainingSeconds = seconds % 60;

                    tvRunningTime.setText(String.format("Running: %02d:%02d", minutes, remainingSeconds));

                    // Update CPU status
                    if (cpuWorkers != null && cpuWorkers.length > 0) {
                        long totalOps = 0;
                        for (CPUStressWorker worker : cpuWorkers) {
                            if (worker != null) {
                                totalOps += worker.getOperations();
                            }
                        }
                        tvCpuStatus.setText("CPU Stress: " + cpuWorkers.length + " threads - " + (totalOps / 1000000) + "M ops");
                    }

                    handler.postDelayed(this, 1000);
                }
            }
        };

        handler.post(updateRunnable);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();

        if (isRunning.get()) {
            stopStressTest();
        }

        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    /**
     * Loads the last saved intensity from SharedPreferences
     * @return Saved intensity (1-10), defaults to 5
     */
    private int loadIntensity() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        return prefs.getInt(KEY_INTENSITY, 5); // Default to medium intensity
    }

    /**
     * Saves the current intensity to SharedPreferences
     * @param intensity Intensity level to save (1-10)
     */
    private void saveIntensity(int intensity) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        editor.putInt(KEY_INTENSITY, intensity);
        editor.apply();
    }
}