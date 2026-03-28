#!/usr/bin/env python3
"""
Visualize benchmark results from LiteLLM vs API Map vs Direct comparison.

Usage:
    python visualize.py results/benchmark_20240326_120000.json
    python visualize.py results/  # Visualize all results
"""

import argparse
import json
import sys
from pathlib import Path
from statistics import mean, median

try:
    import matplotlib
    matplotlib.use('Agg')  # Non-interactive backend for speed
    import matplotlib.pyplot as plt
    import numpy as np
    from matplotlib.backends.backend_pdf import PdfPages
    MATPLOTLIB_AVAILABLE = True
except ImportError:
    MATPLOTLIB_AVAILABLE = False

# Color palette for targets (supports up to 5 targets)
TARGET_COLORS = ['#4a90d9', '#d94a4a', '#4ad94a', '#d94ad9', '#d9a34a']

def load_results(filepath: Path) -> dict:
    """Load benchmark results from JSON file."""
    with open(filepath, 'r') as f:
        return json.load(f)


def calculate_stats(latencies: list) -> dict:
    """Calculate statistics from latency array."""
    if not latencies:
        return {"mean": 0, "p95": 0, "p99": 0, "min": 0, "max": 0}
    sorted_lat = sorted(latencies)
    n = len(sorted_lat)
    return {
        "mean": mean(sorted_lat),
        "p95": sorted_lat[int(n * 0.95)],
        "p99": sorted_lat[int(n * 0.99)],
        "min": sorted_lat[0],
        "max": sorted_lat[-1],
    }


def get_protocol_from_scenario(scenario_name: str, config: dict) -> str:
    """Extract protocol description from scenario configuration."""
    for scenario in config.get('scenarios', []):
        if scenario.get('name') == scenario_name:
            protocol = scenario.get('protocol', {})
            return protocol.get('description', 'OpenAI→OpenAI')
    return 'OpenAI→OpenAI'


def group_by_protocol(results: list, config: dict) -> dict:
    """Group results by protocol for side-by-side comparison."""
    grouped = {}
    for r in results:
        scenario = r.get('scenario', '')
        protocol = get_protocol_from_scenario(scenario, config)
        if protocol not in grouped:
            grouped[protocol] = []
        grouped[protocol].append(r)
    return grouped


def print_text_report(data: dict):
    """Print a text-based report grouped by protocol."""
    print("\n" + "="*70)
    print("BENCHMARK RESULTS")
    print("="*70)
    print(f"Timestamp: {data.get('timestamp', 'N/A')}")
    config = data.get('config', {})
    
    # Latency results - grouped by protocol
    if 'latency' in data and data['latency']:
        print("\n--- Latency Benchmark by Protocol ---")
        latency_by_protocol = group_by_protocol(data['latency'], config)
        for protocol, results in sorted(latency_by_protocol.items()):
            print(f"\n[{protocol}]")
            print(f"{'Target':<15} {'Scenario':<12} {'Mean':<10} {'P95':<10} {'P99':<10} {'Errors':<10}")
            print("-" * 70)
            for r in results:
                stats = calculate_stats(r.get('latencies', []))
                print(f"{r['target']:<15} {r['scenario']:<12} {stats['mean']:<10.1f} "
                      f"{stats['p95']:<10.1f} {stats['p99']:<10.1f} {r.get('errors', 0):<10}")
    
    # Throughput results - grouped by protocol
    if 'throughput' in data and data['throughput']:
        print("\n--- Throughput Benchmark by Protocol ---")
        throughput_by_protocol = group_by_protocol(data['throughput'], config)
        for protocol, results in sorted(throughput_by_protocol.items()):
            print(f"\n[{protocol}]")
            print(f"{'Target':<15} {'Scenario':<12} {'Req/sec':<12} {'Duration':<12} {'Success':<10}")
            print("-" * 70)
            for r in results:
                print(f"{r['target']:<15} {r['scenario']:<12} {r['requestsPerSecond']:<12.1f} "
                      f"{r['durationMs']:<12.1f} {r['totalRequests']}/{r['totalRequests'] + r['errors']}")
    
    # Streaming results - grouped by protocol
    if 'streaming' in data and data['streaming']:
        print("\n--- Streaming Benchmark by Protocol ---")
        # Group streaming results by protocol
        streaming_by_protocol = {}
        for r in data['streaming']:
            protocol = r.get('protocol', 'OpenAI→OpenAI')
            if protocol not in streaming_by_protocol:
                streaming_by_protocol[protocol] = []
            streaming_by_protocol[protocol].append(r)
        
        for protocol, results in sorted(streaming_by_protocol.items()):
            print(f"\n[{protocol}]")
            print(f"{'Target':<15} {'TTFT (ms)':<12} {'TTLT (ms)':<12} {'Tokens/sec':<12} {'Errors':<10}")
            print("-" * 70)
            for r in results:
                print(f"{r['target']:<15} {r['timeToFirstTokenMs']:<12.1f} "
                      f"{r['timeToLastTokenMs']:<12.1f} {r['tokensPerSec']:<12.1f} {r.get('errors', 0):<10}")
    
    print("\n" + "="*70)


def create_visualizations(data: dict, output_path: Path):
    """Create matplotlib visualizations with side-by-side bar charts."""
    if not MATPLOTLIB_AVAILABLE:
        return
    
    with PdfPages(output_path) as pdf:
        # Aggregate latency data by target (across all scenarios)
        latency_by_target = {}
        for r in data.get('latency', []):
            target = r['target']
            if target not in latency_by_target:
                latency_by_target[target] = []
            latency_by_target[target].extend(r.get('latencies', []))
        
        # Calculate aggregated stats
        target_stats = {}
        for target, latencies in latency_by_target.items():
            target_stats[target] = calculate_stats(latencies)
        
        targets = sorted(target_stats.keys())  # Consistent ordering
        num_targets = len(targets)
        
        # Page 1: Side-by-side Latency Comparison
        if targets:
            fig, ax = plt.subplots(figsize=(10, 6))
            
            metrics = ['mean', 'p95', 'p99']
            metric_labels = ['Mean', 'P95', 'P99']
            x = np.arange(len(metrics))
            
            # Dynamic bar width based on number of targets
            width = 0.8 / num_targets
            
            for i, target in enumerate(targets):
                values = [target_stats[target][m] for m in metrics]
                # Center the bars around each x position
                offset = width * (i - (num_targets - 1) / 2)
                bars = ax.bar(x + offset, values, width, label=target, color=TARGET_COLORS[i % len(TARGET_COLORS)], 
                             edgecolor='black', linewidth=1.2)
                # Add value labels on bars
                for bar in bars:
                    height = bar.get_height()
                    ax.text(bar.get_x() + bar.get_width()/2., height,
                           f'{height:.1f}',
                           ha='center', va='bottom', fontsize=9)
            
            ax.set_xlabel('Latency Metric', fontsize=12, fontweight='bold')
            ax.set_ylabel('Milliseconds (ms)', fontsize=12, fontweight='bold')
            ax.set_title('Latency Comparison by Target\n(Lower is Better)', 
                        fontsize=14, fontweight='bold', pad=20)
            ax.set_xticks(x)
            ax.set_xticklabels(metric_labels)
            ax.legend(fontsize=11)
            ax.grid(axis='y', alpha=0.3, linestyle='--')
            ax.set_axisbelow(True)
            
            plt.tight_layout()
            pdf.savefig(fig, dpi=100)
            plt.close()
        
        # Page 2: Throughput by Scenario (Side-by-side)
        throughput_data = data.get('throughput', [])
        if throughput_data:
            # Group by scenario
            scenarios = sorted(set(r['scenario'] for r in throughput_data))
            targets_in_data = sorted(set(r['target'] for r in throughput_data))
            num_targets_tp = len(targets_in_data)
            
            fig, ax = plt.subplots(figsize=(12, 6))
            
            x = np.arange(len(scenarios))
            width = 0.8 / num_targets_tp
            
            for i, target in enumerate(targets_in_data):
                throughputs = []
                for scenario in scenarios:
                    value = 0
                    for r in throughput_data:
                        if r['target'] == target and r['scenario'] == scenario:
                            value = r['requestsPerSecond']
                            break
                    throughputs.append(value)
                
                offset = width * (i - (num_targets_tp - 1) / 2)
                bars = ax.bar(x + offset, throughputs, width, label=target, 
                             color=TARGET_COLORS[i % len(TARGET_COLORS)], edgecolor='black', linewidth=1.2)
                # Add value labels
                for bar in bars:
                    height = bar.get_height()
                    ax.text(bar.get_x() + bar.get_width()/2., height,
                           f'{height:.1f}',
                           ha='center', va='bottom', fontsize=9)
            
            ax.set_xlabel('Scenario', fontsize=12, fontweight='bold')
            ax.set_ylabel('Requests per Second', fontsize=12, fontweight='bold')
            ax.set_title('Throughput Comparison by Scenario\n(Higher is Better)', 
                        fontsize=14, fontweight='bold', pad=20)
            ax.set_xticks(x)
            ax.set_xticklabels([f'Scenario {i+1}' for i in range(len(scenarios))])
            ax.legend(fontsize=11)
            ax.grid(axis='y', alpha=0.3, linestyle='--')
            ax.set_axisbelow(True)
            
            plt.tight_layout()
            pdf.savefig(fig, dpi=100)
            plt.close()
        
        # Page 3: Streaming Comparison (if available)
        streaming_data = data.get('streaming', [])
        if streaming_data:
            fig, ax = plt.subplots(figsize=(10, 6))
            
            targets_stream = sorted(set(r['target'] for r in streaming_data))
            num_targets_stream = len(targets_stream)
            metrics_stream = ['timeToFirstTokenMs', 'tokensPerSec']
            metric_labels_stream = ['TTFT (ms)', 'Tokens/sec']
            x = np.arange(len(metric_labels_stream))
            width = 0.8 / num_targets_stream
            
            for i, target in enumerate(targets_stream):
                values = []
                for r in streaming_data:
                    if r['target'] == target:
                        values = [r['timeToFirstTokenMs'], r['tokensPerSec']]
                        break
                
                if values:
                    offset = width * (i - (num_targets_stream - 1) / 2)
                    bars = ax.bar(x + offset, values, width, label=target,
                                 color=TARGET_COLORS[i % len(TARGET_COLORS)], edgecolor='black', linewidth=1.2)
                    for bar in bars:
                        height = bar.get_height()
                        ax.text(bar.get_x() + bar.get_width()/2., height,
                               f'{height:.1f}',
                               ha='center', va='bottom', fontsize=9)
            
            ax.set_ylabel('Value', fontsize=12, fontweight='bold')
            ax.set_title('Streaming Performance Comparison\n(Lower TTFT is better, Higher Tokens/sec is better)', 
                        fontsize=14, fontweight='bold', pad=20)
            ax.set_xticks(x)
            ax.set_xticklabels(metric_labels_stream)
            ax.legend(fontsize=11)
            ax.grid(axis='y', alpha=0.3, linestyle='--')
            ax.set_axisbelow(True)
            
            plt.tight_layout()
            pdf.savefig(fig, dpi=100)
            plt.close()
        
        # Page 4: Latency Distribution (Box Plot)
        if targets:
            fig, ax = plt.subplots(figsize=(10, 6))
            
            data_for_box = [latency_by_target[t] for t in targets]
            box_plot = ax.boxplot(data_for_box, tick_labels=targets, patch_artist=True)
            
            colors_box = [TARGET_COLORS[i % len(TARGET_COLORS)] for i in range(len(targets))]
            for patch, color in zip(box_plot['boxes'], colors_box):
                patch.set_facecolor(color)
                patch.set_alpha(0.7)
            
            ax.set_xlabel('Target', fontsize=12, fontweight='bold')
            ax.set_ylabel('Latency (ms)', fontsize=12, fontweight='bold')
            ax.set_title('Latency Distribution (All Scenarios)', 
                        fontsize=14, fontweight='bold', pad=20)
            ax.grid(axis='y', alpha=0.3, linestyle='--')
            ax.set_axisbelow(True)
            
            plt.tight_layout()
            pdf.savefig(fig, dpi=100)
            plt.close()
        
        # Page 5: Summary Table
        fig, ax = plt.subplots(figsize=(10, 6))
        ax.axis('off')
        
        # Build table data
        table_data = [['Target', 'Mean (ms)', 'P95 (ms)', 'P99 (ms)', 'Min (ms)', 'Max (ms)']]
        for target in targets:
            stats = target_stats[target]
            table_data.append([
                target,
                f"{stats['mean']:.1f}",
                f"{stats['p95']:.1f}",
                f"{stats['p99']:.1f}",
                f"{stats['min']:.1f}",
                f"{stats['max']:.1f}",
            ])
        
        table = ax.table(cellText=table_data, loc='center', cellLoc='center',
                        colWidths=[0.2, 0.15, 0.15, 0.15, 0.15, 0.15])
        table.auto_set_font_size(False)
        table.set_fontsize(11)
        table.scale(1, 2)
        
        # Style header row
        for i in range(len(table_data[0])):
            table[(0, i)].set_facecolor('#4a90d9')
            table[(0, i)].set_text_props(weight='bold', color='white')
        
        # Highlight winner (lowest mean latency)
        if len(targets) >= 1:
            means = [target_stats[t]['mean'] for t in targets]
            winner_idx = means.index(min(means))
            for i in range(len(table_data[0])):
                table[(winner_idx + 1, i)].set_facecolor('#d4edda')
        
        ax.set_title('Latency Summary\n(Green = Winner)', 
                    fontsize=14, fontweight='bold', pad=20)
        
        plt.tight_layout()
        pdf.savefig(fig, dpi=150)
        plt.close()
    
    print(f"📊 Visualizations saved to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Visualize benchmark results")
    parser.add_argument("input", nargs="?", default="results", 
                       help="JSON results file or directory (default: results/)")
    parser.add_argument("-o", "--output", help="Output PDF file")
    parser.add_argument("--run-id", help="Run ID to visualize (uses results/benchmark_{run_id}.json)")
    parser.add_argument("--text-only", action="store_true", 
                       help="Text output only (no plots)")
    
    args = parser.parse_args()
    
    # If run-id is specified, construct the path
    if args.run_id:
        input_path = Path("results") / f"benchmark_{args.run_id}.json"
        if not input_path.exists():
            print(f"❌ Run not found: {input_path}")
            print(f"Available runs:")
            for f in sorted(Path("results").glob("benchmark_*.json")):
                run_name = f.stem.replace("benchmark_", "")
                print(f"  - {run_name}")
            sys.exit(1)
    else:
        input_path = Path(args.input)
        
        if input_path.is_dir():
            # Find most recent results file
            json_files = list(input_path.glob("benchmark_*.json"))
            if not json_files:
                print(f"No benchmark results found in {input_path}")
                sys.exit(1)
            input_path = max(json_files, key=lambda p: p.stat().st_mtime)
            print(f"Using most recent results: {input_path}")
    
    if not input_path.exists():
        print(f"File not found: {input_path}")
        sys.exit(1)
    
    # Load and display results
    data = load_results(input_path)
    run_id = data.get('runId', input_path.stem.replace('benchmark_', ''))
    print(f"\n📊 Run ID: {run_id}")
    print_text_report(data)
    
    # Create visualizations
    if not args.text_only and MATPLOTLIB_AVAILABLE:
        if args.output:
            output_path = Path(args.output)
        else:
            # Include run ID in output filename
            output_path = Path("reports") / f"benchmark_report_{run_id}.pdf"
            output_path.parent.mkdir(exist_ok=True)
        
        create_visualizations(data, output_path)


if __name__ == "__main__":
    main()
