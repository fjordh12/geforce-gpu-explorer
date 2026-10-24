"""
=============================================================================
NVIDIA GeForce GPU Explorer: Data Ingestion, Cleaning & Analytics Pipeline
Author: Francis Jordan Hasnawi
Domain: Data Analytics & Semiconductor Hardware Metrics
=============================================================================
"""

import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns


def load_dataset(csv_filename="nvidia_gpus_clean.csv"):
    """Loads and verifies the curated GPU dataset."""
    if not os.path.exists(csv_filename):
        csv_filename = os.path.join(os.path.dirname(__file__), csv_filename)
    
    print(f"[1/5] Ingesting dataset from: {csv_filename}")
    df = pd.read_csv(csv_filename)
    print(f"      Loaded {len(df)} GPU models across {df['series'].nunique()} series.")
    return df


def audit_and_validate(df):
    """Validates schema integrity and checks mathematical formulas."""
    print("\n[2/5] Auditing schema and data types...")
    required_cols = ['name', 'series', 'arch', 'cuda', 'boostClock', 'tflops', 'tdp', 'marketPrice']
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    
    # Verify theoretical single-precision TFLOPS formula
    theoretical_tflops = (2 * df['cuda'] * df['boostClock']) / 1e6
    discrepancy = np.abs(df['tflops'] - theoretical_tflops).max()
    print(f"      Schema verified. Max TFLOPS formula discrepancy: {discrepancy:.4f} TFLOPS")


def compute_metrics(df):
    """Computes derived performance-per-dollar and efficiency metrics."""
    print("\n[3/5] Calculating derived analytical metrics...")
    df['calc_price_per_tflops'] = (df['marketPrice'] / df['tflops']).round(2)
    df['calc_perf_per_watt'] = (df['tflops'] / df['tdp']).round(3)
    
    # Top 5 value leaders
    top_value = df.sort_values(by='calc_price_per_tflops').head(5)
    print("\n      Top 5 Best Value GPUs (Lowest $ / TFLOPS):")
    for idx, row in top_value.iterrows():
        print(f"      - {row['name']} ({row['series']}): ${row['calc_price_per_tflops']}/TFLOPS | {row['tflops']} TFLOPS @ ${row['marketPrice']}")
    
    return df


def generate_eda_plots(df, output_dir=None):
    """Generates analytical charts using Seaborn and Matplotlib."""
    print("\n[4/5] Generating EDA summary charts...")
    if output_dir is None:
        output_dir = os.path.dirname(__file__) or '.'
    
    plt.style.use('seaborn-v0_8-whitegrid' if 'seaborn-v0_8-whitegrid' in plt.style.available else 'default')
    
    # 1. Price vs TFLOPS Scatter Plot
    fig, ax = plt.subplots(figsize=(10, 6))
    series_order = ['GTX 10', 'GTX 16', 'RTX 20', 'RTX 30', 'RTX 40', 'RTX 50']
    sns.scatterplot(
        data=df,
        x='marketPrice',
        y='tflops',
        hue='series',
        hue_order=series_order,
        size='vram',
        sizes=(40, 240),
        alpha=0.88,
        ax=ax
    )
    ax.set_xscale('log')
    ax.set_title("NVIDIA GPUs: FP32 Compute vs Market Price (Log Scale)", pad=14, fontweight='bold')
    ax.set_xlabel("Market Price in USD (Logarithmic Scale)")
    ax.set_ylabel("Theoretical FP32 Compute (TFLOPS)")
    plt.tight_layout()
    scatter_path = os.path.join(output_dir, "eda_price_vs_tflops.png")
    fig.savefig(scatter_path, dpi=150)
    plt.close(fig)
    print(f"      Saved: {scatter_path}")

    # 2. Correlation Heatmap
    fig, ax = plt.subplots(figsize=(8, 6))
    corr_features = ['cuda', 'boostClock', 'vram', 'bus', 'tdp', 'marketPrice', 'tflops']
    sns.heatmap(df[corr_features].corr(), annot=True, cmap='coolwarm', fmt='.2f', ax=ax)
    ax.set_title("Architectural Specification Correlation Matrix", pad=14, fontweight='bold')
    plt.tight_layout()
    corr_path = os.path.join(output_dir, "eda_correlation_matrix.png")
    fig.savefig(corr_path, dpi=150)
    plt.close(fig)
    print(f"      Saved: {corr_path}")


def main():
    print("=" * 70)
    print("NVIDIA GEFORCE DATA ANALYTICS PIPELINE")
    print("=" * 70)
    df = load_dataset()
    audit_and_validate(df)
    df = compute_metrics(df)
    generate_eda_plots(df)
    print("\n[5/5] Pipeline execution complete! Ready for web deployment.")
    print("=" * 70)


if __name__ == "__main__":
    main()
