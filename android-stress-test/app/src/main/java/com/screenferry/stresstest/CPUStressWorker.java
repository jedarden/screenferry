package com.screenferry.stresstest;

import java.util.concurrent.atomic.AtomicLong;
import java.util.Random;

/**
 * CPU Stress Worker
 * Performs intensive mathematical operations to stress the CPU
 */
public class CPUStressWorker implements Runnable {

    private final int intensity;
    private final AtomicBoolean running = new AtomicBoolean(true);
    private final AtomicLong operations = new AtomicLong(0);
    private final Random random = new Random();

    public CPUStressWorker(int intensity) {
        this.intensity = intensity;
    }

    @Override
    public void run() {
        running.set(true);

        while (running.get()) {
            try {
                performCPUIntensiveTask();
            } catch (Exception e) {
                // Thread interrupted or other error
                break;
            }
        }
    }

    /**
     * Performs various CPU-intensive mathematical operations
     */
    private void performCPUIntensiveTask() {
        // Adjust computational load based on intensity
        int iterations = 100 + (intensity * 100);

        for (int i = 0; i < iterations && running.get(); i++) {
            // Matrix multiplication simulation
            double[][] matrixA = generateRandomMatrix(4 + intensity/2);
            double[][] matrixB = generateRandomMatrix(4 + intensity/2);
            double[][] result = multiplyMatrices(matrixA, matrixB);

            // Prime number calculation
            int start = random.nextInt(1000);
            int count = 10 + intensity;
            findPrimes(start, count);

            // Fibonacci sequence
            int n = 20 + intensity;
            calculateFibonacci(n);

            operations.incrementAndGet();
        }

        // Small sleep to prevent complete CPU freeze at very high intensity
        try {
            Thread.sleep(Math.max(1, 10 - intensity));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * Generates a random matrix for computation
     */
    private double[][] generateRandomMatrix(int size) {
        double[][] matrix = new double[size][size];
        for (int i = 0; i < size; i++) {
            for (int j = 0; j < size; j++) {
                matrix[i][j] = random.nextDouble() * 100;
            }
        }
        return matrix;
    }

    /**
     * Multiplies two matrices
     */
    private double[][] multiplyMatrices(double[][] a, double[][] b) {
        int rowsA = a.length;
        int colsA = a[0].length;
        int colsB = b[0].length;

        double[][] result = new double[rowsA][colsB];

        for (int i = 0; i < rowsA; i++) {
            for (int j = 0; j < colsB; j++) {
                for (int k = 0; k < colsA; k++) {
                    result[i][j] += a[i][k] * b[k][j];
                }
            }
        }

        return result;
    }

    /**
     * Finds prime numbers (computationally intensive)
     */
    private int[] findPrimes(int start, int count) {
        int[] primes = new int[count];
        int found = 0;
        int current = start;

        while (found < count && running.get()) {
            if (isPrime(current)) {
                primes[found++] = current;
            }
            current++;
        }

        return primes;
    }

    /**
     * Checks if a number is prime
     */
    private boolean isPrime(int n) {
        if (n <= 1) return false;
        if (n == 2) return true;
        if (n % 2 == 0) return false;

        for (int i = 3; i * i <= n; i += 2) {
            if (n % i == 0) return false;
        }
        return true;
    }

    /**
     * Calculates Fibonacci sequence (recursive, CPU intensive)
     */
    private long calculateFibonacci(int n) {
        if (n <= 1) return n;

        long[] fib = new long[n + 1];
        fib[0] = 0;
        fib[1] = 1;

        for (int i = 2; i <= n; i++) {
            fib[i] = fib[i - 1] + fib[i - 2];
        }

        return fib[n];
    }

    /**
     * Stops the worker
     */
    public void stop() {
        running.set(false);
    }

    /**
     * Gets the number of operations performed
     */
    public long getOperations() {
        return operations.get();
    }

    public boolean isRunning() {
        return running.get();
    }
}