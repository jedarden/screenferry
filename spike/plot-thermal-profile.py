#!/usr/bin/env python3
"""
Plot thermal profile data from the long-run thermal test.

Usage: python spike/plot-thermal-profile.py thermal-profile-YYYY-MM-DD.csv

This creates a multi-panel plot showing:
- Top panel: Camera fps over time
- Middle panel: Decode latency (p50, p99) over time
- Bottom panel: Erasure rate over time
"""

import sys
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime, timedelta

def plot_thermal_profile(csv_file):
    # Load the data
    df = pd.read_csv(csv_file)

    # Convert elapsed_sec to timedelta for plotting
    df['time'] = pd.to_timedelta(df['elapsed_sec'], unit='s')

    # Create figure with 3 subplots sharing x-axis
    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(12, 10), sharex=True)

    # Plot 1: Camera FPS
    ax1.plot(df['time'].dt.total_seconds() / 60, df['camera_fps'], 'b-', linewidth=2, label='Camera FPS')
    ax1.axhline(df['camera_fps'].iloc[:5].mean(), color='g', linestyle='--', alpha=0.5, label='Baseline (first 5 points)')
    ax1.set_ylabel('Camera FPS', fontsize=12, fontweight='bold')
    ax1.set_title('Long-run thermal profile — R11, D27, §18.2', fontsize=14, fontweight='bold')
    ax1.legend()
    ax1.grid(True, alpha=0.3)

    # Add annotation for >30% degradation if it occurs
    baseline_fps = df['camera_fps'].iloc[:5].mean()
    min_fps = df['camera_fps'].min()
    fps_deg = ((baseline_fps - min_fps) / baseline_fps) * 100
    if fps_deg > 30:
        ax1.annotate(f'⚠️ {fps_deg:.1f}% degradation from baseline\n(possible thermal throttling)',
                     xy=(df['time'].dt.total_seconds().min() / 60, min_fps),
                     xytext=(10, min_fps + 0.5),
                     fontsize=10, color='red',
                     bbox=dict(boxstyle='round,pad=0.5', facecolor='yellow', alpha=0.3))

    # Plot 2: Decode latency
    ax2.plot(df['time'].dt.total_seconds() / 60, df['decode_p50_ms'], 'r-', linewidth=2, label='Decode p50 (ms)')
    ax2.plot(df['time'].dt.total_seconds() / 60, df['decode_p99_ms'], 'r--', linewidth=1.5, alpha=0.7, label='Decode p99 (ms)')
    ax2.axhline(df['decode_p50_ms'].iloc[:5].mean(), color='g', linestyle='--', alpha=0.5, label='Baseline p50')
    ax2.set_ylabel('Decode latency (ms)', fontsize=12, fontweight='bold')
    ax2.legend()
    ax2.grid(True, alpha=0.3)

    # Add annotation for >30% degradation if it occurs
    baseline_decode = df['decode_p50_ms'].iloc[:5].mean()
    max_decode = df['decode_p50_ms'].max()
    decode_deg = ((max_decode - baseline_decode) / baseline_decode) * 100
    if decode_deg > 30:
        ax2.annotate(f'⚠️ {decode_deg:.1f}% degradation from baseline\n(possible thermal throttling)',
                     xy=(df['time'].dt.total_seconds().min() / 60, max_decode),
                     xytext=(10, max_decode - 2),
                     fontsize=10, color='red',
                     bbox=dict(boxstyle='round,pad=0.5', facecolor='yellow', alpha=0.3))

    # Plot 3: Erasure rate
    ax3.plot(df['time'].dt.total_seconds() / 60, df['erasure_pct'], 'm-', linewidth=2, label='Erasure rate (%)')
    ax3.axhline(30, color='orange', linestyle='--', alpha=0.7, label='30% threshold (D18c assumption)')
    ax3.set_xlabel('Elapsed time (minutes)', fontsize=12, fontweight='bold')
    ax3.set_ylabel('Erasure rate (%)', fontsize=12, fontweight='bold')
    ax3.legend()
    ax3.grid(True, alpha=0.3)

    # Overall formatting
    for ax in [ax1, ax2, ax3]:
        ax.set_xlim(left=0)

    plt.tight_layout()

    # Save plot
    output_file = csv_file.replace('.csv', '.png')
    plt.savefig(output_file, dpi=150, bbox_inches='tight')
    print(f'Plot saved to {output_file}')

    # Print summary statistics
    print('\n' + '='*60)
    print('THERMAL PROFILE SUMMARY')
    print('='*60)
    print(f'Test duration: {df["elapsed_min"].max():.1f} minutes ({df["elapsed_sec"].max():.0f} seconds)')
    print(f'Data points collected: {len(df)}')
    print()
    print('Camera FPS:')
    print(f'  Baseline (first 5): {baseline_fps:.2f}')
    print(f'  Overall mean: {df["camera_fps"].mean():.2f}')
    print(f'  Minimum: {df["camera_fps"].min():.2f} (degradation: {fps_deg:.1f}%)')
    print()
    print('Decode p50 latency:')
    print(f'  Baseline (first 5): {baseline_decode:.2f} ms')
    print(f'  Overall mean: {df["decode_p50_ms"].mean():.2f} ms')
    print(f'  Maximum: {max_decode:.2f} ms (degradation: {decode_deg:.1f}%)')
    print()
    print('Erasure rate:')
    print(f'  Mean: {df["erasure_pct"].mean():.1f}%')
    print(f'  Maximum: {df["erasure_pct"].max():.1f}%')
    print()
    print('R11 Trigger check (>30% degradation):')
    if fps_deg > 30 or decode_deg > 30:
        print(f'  ⚠️ TRIPPED: {fps_deg:.1f}% FPS degradation, {decode_deg:.1f}% decode degradation')
        print('  → Action required: implement duty-cycling (D27)')
    else:
        print(f'  ✓ Not tripped: {fps_deg:.1f}% FPS degradation, {decode_deg:.1f}% decode degradation')
    print('='*60)

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: python plot-thermal-profile.py <thermal-profile-csv>')
        sys.exit(1)

    plot_thermal_profile(sys.argv[1])
