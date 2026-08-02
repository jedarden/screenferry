#!/usr/bin/env python3
"""
Plot comparison between baseline and duty-cycle thermal profiles.

Usage: python spike/plot-thermal-profile-comparison.py <baseline-csv> <dutycycle-csv>

This creates a multi-panel comparison plot showing:
- Top panel: Camera fps comparison (baseline vs 50% duty cycle)
- Middle panel: Decode latency comparison (p50, p99)
- Bottom panel: Erasure rate comparison
- Summary statistics comparing the two runs

This validates D27's claim: "50% duty roughly halves heat for roughly half the rate, and finishes"
"""

import sys
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime, timedelta

def plot_thermal_profile_comparison(baseline_csv, dutycycle_csv):
    # Load the data
    df_baseline = pd.read_csv(baseline_csv)
    df_dutycycle = pd.read_csv(dutycycle_csv)

    # Add prefix to column names to distinguish datasets
    df_baseline = df_baseline.add_prefix('baseline_')
    df_dutycycle = df_dutycycle.add_prefix('dutycycle_')

    # Create figure with 3 subplots sharing x-axis
    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(14, 12), sharex=True)

    # Plot 1: Camera FPS comparison
    ax1.plot(df_baseline['baseline_elapsed_sec'] / 60, df_baseline['baseline_camera_fps'],
             'b-', linewidth=2, label='Baseline (100% duty)', alpha=0.7)
    ax1.plot(df_dutycycle['dutycycle_elapsed_sec'] / 60, df_dutycycle['dutycycle_camera_fps'],
             'r-', linewidth=2, label='Duty cycle (50% duty)', alpha=0.7)

    # Add effective FPS for duty cycle
    if 'dutycycle_effective_fps' in df_dutycycle.columns:
        ax1.plot(df_dutycycle['dutycycle_elapsed_sec'] / 60, df_dutycycle['dutycycle_effective_fps'],
                 'r--', linewidth=1.5, label='Effective FPS (50% × measured)', alpha=0.5)

    ax1.set_ylabel('Camera FPS', fontsize=12, fontweight='bold')
    ax1.set_title('D27 Validation: 50% Duty-Cycle Thermal Profile Comparison', fontsize=14, fontweight='bold')
    ax1.legend(loc='upper right')
    ax1.grid(True, alpha=0.3)

    # Plot 2: Decode latency comparison
    ax2.plot(df_baseline['baseline_elapsed_sec'] / 60, df_baseline['baseline_decode_p50_ms'],
             'b-', linewidth=2, label='Baseline p50', alpha=0.7)
    ax2.plot(df_baseline['baseline_elapsed_sec'] / 60, df_baseline['baseline_decode_p99_ms'],
             'b--', linewidth=1.5, label='Baseline p99', alpha=0.5)
    ax2.plot(df_dutycycle['dutycycle_elapsed_sec'] / 60, df_dutycycle['dutycycle_decode_p50_ms'],
             'r-', linewidth=2, label='Duty cycle p50', alpha=0.7)
    ax2.plot(df_dutycycle['dutycycle_elapsed_sec'] / 60, df_dutycycle['dutycycle_decode_p99_ms'],
             'r--', linewidth=1.5, label='Duty cycle p99', alpha=0.5)
    ax2.set_ylabel('Decode latency (ms)', fontsize=12, fontweight='bold')
    ax2.legend(loc='upper right')
    ax2.grid(True, alpha=0.3)

    # Plot 3: Erasure rate comparison
    ax3.plot(df_baseline['baseline_elapsed_sec'] / 60, df_baseline['baseline_erasure_pct'],
             'b-', linewidth=2, label='Baseline', alpha=0.7)
    ax3.plot(df_dutycycle['dutycycle_elapsed_sec'] / 60, df_dutycycle['dutycycle_erasure_pct'],
             'r-', linewidth=2, label='Duty cycle', alpha=0.7)
    ax3.axhline(30, color='orange', linestyle='--', alpha=0.7, label='30% threshold (D18c assumption)')
    ax3.set_xlabel('Elapsed time (minutes)', fontsize=12, fontweight='bold')
    ax3.set_ylabel('Erasure rate (%)', fontsize=12, fontweight='bold')
    ax3.legend(loc='upper right')
    ax3.grid(True, alpha=0.3)

    # Overall formatting
    for ax in [ax1, ax2, ax3]:
        ax.set_xlim(left=0)

    plt.tight_layout()

    # Save plot
    output_file = f'dutycycle-comparison-{datetime.now().strftime("%Y%m%d-%H%M%S")}.png'
    plt.savefig(output_file, dpi=150, bbox_inches='tight')
    print(f'Plot saved to {output_file}')

    # Calculate summary statistics
    baseline_fps_mean = df_baseline['baseline_camera_fps'].mean()
    dutycycle_fps_mean = df_dutycycle['dutycycle_camera_fps'].mean()

    baseline_decode_p50_mean = df_baseline['baseline_decode_p50_ms'].mean()
    dutycycle_decode_p50_mean = df_dutycycle['dutycycle_decode_p50_ms'].mean()

    baseline_erasure_mean = df_baseline['baseline_erasure_pct'].mean()
    dutycycle_erasure_mean = df_dutycycle['dutycycle_erasure_pct'].mean()

    # Calculate FPS degradation
    baseline_fps_first = df_baseline['baseline_camera_fps'].iloc[:5].mean()
    baseline_fps_last = df_baseline['baseline_camera_fps'].iloc[-5:].mean()
    baseline_fps_deg = ((baseline_fps_first - baseline_fps_last) / baseline_fps_first) * 100

    dutycycle_fps_first = df_dutycycle['dutycycle_camera_fps'].iloc[:5].mean()
    dutycycle_fps_last = df_dutycycle['dutycycle_camera_fps'].iloc[-5:].mean()
    dutycycle_fps_deg = ((dutycycle_fps_first - dutycycle_fps_last) / dutycycle_fps_first) * 100

    # Calculate decode degradation
    baseline_decode_first = df_baseline['baseline_decode_p50_ms'].iloc[:5].mean()
    baseline_decode_last = df_baseline['baseline_decode_p50_ms'].iloc[-5:].mean()
    baseline_decode_deg = ((baseline_decode_last - baseline_decode_first) / baseline_decode_first) * 100

    dutycycle_decode_first = df_dutycycle['dutycycle_decode_p50_ms'].iloc[:5].mean()
    dutycycle_decode_last = df_dutycycle['dutycycle_decode_p50_ms'].iloc[-5:].mean()
    dutycycle_decode_deg = ((dutycycle_decode_last - dutycycle_decode_first) / dutycycle_decode_first) * 100

    # Calculate heat reduction proxy
    heat_reduction_proxy = ((baseline_fps_mean - dutycycle_fps_mean) / baseline_fps_mean) * 100

    # Calculate effective rate reduction
    if 'dutycycle_effective_fps' in df_dutycycle.columns:
        effective_fps_mean = df_dutycycle['dutycycle_effective_fps'].mean()
        rate_reduction = ((baseline_fps_mean - effective_fps_mean) / baseline_fps_mean) * 100
    else:
        # Assume 50% effective rate if no column
        effective_fps_mean = dutycycle_fps_mean * 0.5
        rate_reduction = ((baseline_fps_mean - effective_fps_mean) / baseline_fps_mean) * 100

    # Print summary statistics
    print('\n' + '='*70)
    print('D27 VALIDATION: 50% DUTY-CYCLE THERMAL PROFILE COMPARISON')
    print('='*70)

    print('\nDURATION:')
    print(f'  Baseline: {df_baseline["baseline_elapsed_min"].max():.1f} minutes')
    print(f'  Duty cycle: {df_dutycycle["dutycycle_elapsed_min"].max():.1f} minutes')

    print('\nCAMERA FPS:')
    print(f'  Baseline mean: {baseline_fps_mean:.2f} fps')
    print(f'  Duty cycle mean: {dutycycle_fps_mean:.2f} fps')
    print(f'  Heat reduction proxy: {heat_reduction_proxy:.1f}% (lower is better)')
    print(f'  Effective rate (50% × measured): {effective_fps_mean:.2f} fps')
    print(f'  Rate reduction: {rate_reduction:.1f}%')

    print('\nDECODE LATENCY (p50):')
    print(f'  Baseline mean: {baseline_decode_p50_mean:.2f} ms')
    print(f'  Duty cycle mean: {dutycycle_decode_p50_mean:.2f} ms')
    print(f'  Difference: {dutycycle_decode_p50_mean - baseline_decode_p50_mean:+.2f} ms')

    print('\nERASURE RATE:')
    print(f'  Baseline mean: {baseline_erasure_mean:.1f}%')
    print(f'  Duty cycle mean: {dutycycle_erasure_mean:.1f}%')
    print(f'  Difference: {dutycycle_erasure_mean - baseline_erasure_mean:+.1f}%')

    print('\nTHERMAL DEGRADATION (FPS):')
    print(f'  Baseline: {baseline_fps_deg:+.1f}% ({"tripped R11" if abs(baseline_fps_deg) > 30 else "stable"})')
    print(f'  Duty cycle: {dutycycle_fps_deg:+.1f}% ({"tripped R11" if abs(dutycycle_fps_deg) > 30 else "stable"})')

    print('\nTHERMAL DEGRADATION (DECODE):')
    print(f'  Baseline: {baseline_decode_deg:+.1f}% ({"tripped R11" if abs(baseline_decode_deg) > 30 else "stable"})')
    print(f'  Duty cycle: {dutycycle_decode_deg:+.1f}% ({"tripped R11" if abs(dutycycle_decode_deg) > 30 else "stable"})')

    print('\n' + '='*70)
    print('D27 VALIDATION RESULT:')
    print('='*70)

    # Check if D27's claims are validated
    validations = []

    # Claim 1: 50% duty roughly halves heat
    if 40 <= heat_reduction_proxy <= 60:
        validations.append(('✓ Heat reduction', f'{heat_reduction_proxy:.1f}% reduction is ~50% (D27 validated)'))
    else:
        validations.append(('⚠️ Heat reduction', f'{heat_reduction_proxy:.1f}% reduction differs from ~50% (needs investigation)'))

    # Claim 2: 50% duty roughly halves rate
    if 40 <= rate_reduction <= 60:
        validations.append(('✓ Rate reduction', f'{rate_reduction:.1f}% reduction is ~50% (D27 validated)'))
    else:
        validations.append(('⚠️ Rate reduction', f'{rate_reduction:.1f}% reduction differs from ~50% (needs investigation)'))

    # Claim 3: Duty cycle completes where 100% duty may not
    baseline_completed = abs(baseline_fps_deg) < 30 and abs(baseline_decode_deg) < 30
    dutycycle_completed = abs(dutycycle_fps_deg) < 30 and abs(dutycycle_decode_deg) < 30

    if dutycycle_completed and not baseline_completed:
        validations.append(('✓ Completion', 'Duty cycle stayed stable where baseline degraded (D27 validated)'))
    elif dutycycle_completed and baseline_completed:
        validations.append(('ℹ️ Completion', 'Both stayed stable (test may need longer duration)'))
    elif not dutycycle_completed:
        validations.append(('⚠️ Completion', 'Duty cycle still degraded (may need lower duty %)'))

    for title, result in validations:
        print(f'  {title}: {result}')

    print('\nOVERALL ASSESSMENT:')
    all_validated = all('✓' in v[0] for v in validations)
    if all_validated:
        print('  ✓ D27 VALIDATED: 50% duty-cycling roughly halves heat for roughly half the rate')
        print('  and completes where 100% duty may not.')
    else:
        warnings = [v[1] for v in validations if '⚠️' in v[0]]
        if warnings:
            print('  ⚠️ PARTIAL VALIDATION: Some claims need investigation:')
            for w in warnings:
                print(f'    - {w}')

    print('='*70)

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('Usage: python plot-thermal-profile-comparison.py <baseline-csv> <dutycycle-csv>')
        sys.exit(1)

    plot_thermal_profile_comparison(sys.argv[1], sys.argv[2])