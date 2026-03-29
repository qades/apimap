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


def get_scenario_description(scenario_name: str, config: dict) -> str:
    """Get human-readable scenario description."""
    for scenario in config.get('scenarios', []):
        if scenario.get('name') == scenario_name:
            concurrency = scenario.get('concurrency', 1)
            requests = scenario.get('requests', 0)
            protocol = scenario.get('protocol', {})
            proto_desc = protocol.get('description', 'OpenAI→OpenAI')
            return f"{concurrency} concurrent, {requests} req [{proto_desc}]"
    return scenario_name


def get_scenario_concurrency(scenario_name: str, config: dict) -> int:
    """Get concurrency level for a scenario."""
    for scenario in config.get('scenarios', []):
        if scenario.get('name') == scenario_name:
            return scenario.get('concurrency', 1)
    return 1


def get_scenario_protocol_description(scenario_name: str, config: dict) -> str:
    """Get protocol description for a scenario."""
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


def print_text_report(data: dict, config: dict = None):
    """Print a text-based report grouped by protocol."""
    print("\n" + "="*70)
    print("BENCHMARK RESULTS")
    print("="*70)
    print(f"Timestamp: {data.get('timestamp', 'N/A')}")
    if config is None:
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


def group_results_by_concurrency_and_protocol(results: list, config: dict) -> dict:
    """Group results by (concurrency, protocol) tuple."""
    grouped = {}
    for r in results:
        scenario_name = r.get('scenario', '')
        concurrency = get_scenario_concurrency(scenario_name, config)
        protocol = get_protocol_from_scenario(scenario_name, config)
        key = (concurrency, protocol)
        if key not in grouped:
            grouped[key] = []
        grouped[key].append(r)
    return grouped

def create_visualizations(data: dict, output_path: Path, config: dict = None):
    """Create matplotlib visualizations - 1 page per concurrency-protocol combination.
    
    Layout: Targets on Y-axis, metrics on X-axis for easy comparison.
    """
    if not MATPLOTLIB_AVAILABLE:
        return
    
    if config is None:
        config = data.get('config', {})
    
    with PdfPages(output_path) as pdf:
        latency_data = data.get('latency', [])
        throughput_data = data.get('throughput', [])
        
        # Group by (concurrency, protocol)
        latency_grouped = group_results_by_concurrency_and_protocol(latency_data, config)
        throughput_grouped = group_results_by_concurrency_and_protocol(throughput_data, config)
        
        # Get all unique (concurrency, protocol) combinations
        all_keys = sorted(set(list(latency_grouped.keys()) + list(throughput_grouped.keys())))
        
        # Page per (concurrency, protocol) combination
        for concurrency, protocol in all_keys:
            lat_results = latency_grouped.get((concurrency, protocol), [])
            tp_results = throughput_grouped.get((concurrency, protocol), [])
            
            if not lat_results and not tp_results:
                continue
            
            # Get targets
            targets = sorted(set(r['target'] for r in lat_results + tp_results))
            if not targets:
                continue
            
            # Create figure with 2 subplots (latency and throughput)
            fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
            fig.suptitle(f'{protocol} @ {concurrency} Concurrent Requests', 
                        fontsize=16, fontweight='bold', y=0.98)
            
            # --- Latency subplot (horizontal bars) ---
            if lat_results:
                metrics = ['mean', 'p95']
                metric_labels = ['Mean', 'P95']
                y = np.arange(len(targets))
                height = 0.6 / len(metrics)
                
                for j, metric in enumerate(metrics):
                    values = []
                    for target in targets:
                        target_lats = [r for r in lat_results if r['target'] == target]
                        if target_lats:
                            stats = calculate_stats(target_lats[0].get('latencies', []))
                            values.append(stats[metric])
                        else:
                            values.append(0)
                    
                    offset = height * (j - (len(metrics) - 1) / 2)
                    bars = ax1.barh(y + offset, values, height, label=metric_labels[j],
                                   color=TARGET_COLORS[j % len(TARGET_COLORS)],
                                   edgecolor='black', linewidth=1.2)
                    # Add value labels
                    for i, bar in enumerate(bars):
                        width_val = bar.get_width()
                        if width_val > 0:
                            ax1.text(width_val, bar.get_y() + bar.get_height()/2.,
                                   f' {width_val:.1f}',
                                   ha='left', va='center', fontsize=8)
                
                ax1.set_xlabel('Milliseconds (ms)', fontsize=11, fontweight='bold')
                ax1.set_title('Latency (Lower is Better)', fontsize=12, fontweight='bold')
                ax1.set_yticks(y)
                ax1.set_yticklabels(targets)
                ax1.legend(fontsize=10, loc='lower right')
                ax1.grid(axis='x', alpha=0.3, linestyle='--')
                ax1.set_axisbelow(True)
            
            # --- Throughput subplot (horizontal bars) ---
            if tp_results:
                y = np.arange(len(targets))
                throughputs = []
                
                for target in targets:
                    target_tp = [r for r in tp_results if r['target'] == target]
                    if target_tp:
                        throughputs.append(target_tp[0]['requestsPerSecond'])
                    else:
                        throughputs.append(0)
                
                bars = ax2.barh(y, throughputs, color=[TARGET_COLORS[i % len(TARGET_COLORS)] for i in range(len(targets))],
                              edgecolor='black', linewidth=1.2, height=0.6)
                # Add value labels
                for i, bar in enumerate(bars):
                    width_val = bar.get_width()
                    if width_val > 0:
                        ax2.text(width_val, bar.get_y() + bar.get_height()/2.,
                               f' {width_val:.1f}',
                               ha='left', va='center', fontsize=9)
                
                ax2.set_xlabel('Requests per Second', fontsize=11, fontweight='bold')
                ax2.set_title('Throughput (Higher is Better)', fontsize=12, fontweight='bold')
                ax2.set_yticks(y)
                ax2.set_yticklabels(targets)
                ax2.grid(axis='x', alpha=0.3, linestyle='--')
                ax2.set_axisbelow(True)
            
            plt.tight_layout(rect=[0, 0, 1, 0.96])  # Make room for suptitle
            pdf.savefig(fig, dpi=100)
            plt.close()
        
        # Summary page at the end
        if all_keys:
            create_summary_page(pdf, data, all_keys)
        elif throughput_data:
            # Fallback: simple grouped chart if no config available
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
            ax.set_xticklabels([f'Scenario {i+1}' for i in range(len(scenarios))], fontsize=9)
            ax.legend(fontsize=11)
            ax.grid(axis='y', alpha=0.3, linestyle='--')
            ax.set_axisbelow(True)
            
            plt.tight_layout()
            pdf.savefig(fig, dpi=100)
            plt.close()
        
        # Streaming summary page (if available)
        streaming_data = data.get('streaming', [])
        if streaming_data:
            create_streaming_summary_page(pdf, streaming_data)
        
        # Summary table page
        if all_keys:
            create_summary_page(pdf, data, all_keys)
    
    print(f"📊 Visualizations saved to: {output_path}")


def create_summary_page(pdf, data: dict, all_keys: list):
    """Create a summary table page at the end."""
    fig, ax = plt.subplots(figsize=(12, 8))
    ax.axis('off')
    
    # Build summary data
    table_data = [['Concurrency', 'Protocol', 'Target', 'Latency Mean', 'Throughput']]
    
    for concurrency, protocol in sorted(all_keys):
        # Find latency and throughput for this combination
        lat_results = [r for r in data.get('latency', []) 
                      if get_scenario_concurrency(r.get('scenario', ''), data.get('config', {})) == concurrency
                      and get_protocol_from_scenario(r.get('scenario', ''), data.get('config', {})) == protocol]
        tp_results = [r for r in data.get('throughput', []) 
                     if get_scenario_concurrency(r.get('scenario', ''), data.get('config', {})) == concurrency
                     and get_protocol_from_scenario(r.get('scenario', ''), data.get('config', {})) == protocol]
        
        targets = sorted(set(r['target'] for r in lat_results + tp_results))
        
        for target in targets:
            lat = next((r for r in lat_results if r['target'] == target), None)
            tp = next((r for r in tp_results if r['target'] == target), None)
            
            lat_mean = f"{calculate_stats(lat.get('latencies', []))['mean']:.1f} ms" if lat else 'N/A'
            tp_val = f"{tp['requestsPerSecond']:.1f} req/s" if tp else 'N/A'
            
            table_data.append([str(concurrency), protocol, target, lat_mean, tp_val])
    
    table = ax.table(cellText=table_data, loc='center', cellLoc='center',
                    colWidths=[0.12, 0.28, 0.15, 0.2, 0.25])
    table.auto_set_font_size(False)
    table.set_fontsize(9)
    table.scale(1, 1.8)
    
    # Style header row
    for i in range(len(table_data[0])):
        table[(0, i)].set_facecolor('#4a90d9')
        table[(0, i)].set_text_props(weight='bold', color='white')
    
    # Alternate row colors
    for i in range(1, len(table_data)):
        color = '#f0f0f0' if i % 2 == 0 else 'white'
        for j in range(len(table_data[0])):
            table[(i, j)].set_facecolor(color)
    
    ax.set_title('Benchmark Summary by Concurrency & Protocol', 
                fontsize=14, fontweight='bold', pad=20)
    
    plt.tight_layout()
    pdf.savefig(fig, dpi=150)
    plt.close()


def create_streaming_summary_page(pdf, streaming_data: list):
    """Create a streaming performance summary page with scatter plots showing distribution and outliers.
    
    Axes flipped: Metric on X-axis, Protocol+Target on Y-axis.
    Grouped by: Source Protocol, then Contender (Target).
    """
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
    fig.suptitle('Streaming Performance Analysis', fontsize=16, fontweight='bold', y=0.98)
    
    # Group by protocol
    by_protocol = {}
    for r in streaming_data:
        protocol = r.get('protocol', 'Unknown')
        if protocol not in by_protocol:
            by_protocol[protocol] = []
        by_protocol[protocol].append(r)
    
    # Group by source protocol first, then contender (target)
    protocols = sorted(by_protocol.keys())
    targets = sorted(set(r['target'] for r in streaming_data))
    
    # Build Y-axis positions: group by protocol, then target within each protocol
    y_positions = {}  # (protocol, target) -> y_position
    y_labels = []  # Labels for Y-axis ticks
    box_labels = []  # Labels for box plot
    box_colors = []  # Colors for box plot
    y_pos = 0
    
    for protocol in protocols:
        for target in targets:
            y_positions[(protocol, target)] = y_pos
            y_labels.append(f"{protocol} | {target}")
            box_labels.append(f"{protocol} | {target}")
            target_idx = targets.index(target)
            box_colors.append(TARGET_COLORS[target_idx % len(TARGET_COLORS)])
            y_pos += 1
    
    # --- Left plot: Scatter plot of individual runs (tokens/sec) ---
    # With FLIPPED axes: X = tokens/sec, Y = protocol+target position
    all_tokens_per_sec = []
    y_positions_scatter = []
    colors = []
    
    for protocol in protocols:
        for target in targets:
            results = [r for r in by_protocol[protocol] if r['target'] == target]
            y_base = y_positions[(protocol, target)]
            for r in results:
                runs = r.get('runs', [])
                if not runs:
                    runs = [{'tokensPerSec': r['tokensPerSec']}]
                
                for run in runs:
                    all_tokens_per_sec.append(run['tokensPerSec'])
                    y_positions_scatter.append(y_base)
                    target_idx = targets.index(target)
                    colors.append(TARGET_COLORS[target_idx % len(TARGET_COLORS)])
    
    # Create jitter on Y-axis for better visibility
    jitter = np.random.uniform(-0.15, 0.15, len(y_positions_scatter))
    y_jittered = [y + j for y, j in zip(y_positions_scatter, jitter)]
    
    ax1.scatter(all_tokens_per_sec, y_jittered, c=colors, alpha=0.6, s=60, edgecolors='black', linewidth=0.5)
    
    # Add mean lines (vertical now, since axes are flipped)
    for protocol in protocols:
        for target in targets:
            results = [r for r in by_protocol[protocol] if r['target'] == target]
            y_base = y_positions[(protocol, target)]
            for r in results:
                mean_val = r['tokensPerSec']
                ax1.vlines(mean_val, y_base - 0.3, y_base + 0.3, colors='red', linestyles='--', linewidth=2, alpha=0.8)
    
    ax1.set_yticks(range(len(y_labels)))
    ax1.set_yticklabels(y_labels, fontsize=8)
    ax1.set_xlabel('Tokens per Second', fontsize=11, fontweight='bold')
    ax1.set_title('Tokens/Sec Distribution (Individual Runs)\nRed line = Mean', fontsize=12, fontweight='bold')
    ax1.grid(axis='x', alpha=0.3, linestyle='--')
    ax1.set_axisbelow(True)
    
    # --- Right plot: Horizontal box plot showing distribution and outliers ---
    # With FLIPPED axes: horizontal boxes
    box_data = []
    
    for protocol in protocols:
        for target in targets:
            results = [r for r in by_protocol[protocol] if r['target'] == target]
            for r in results:
                runs = r.get('runs', [])
                if runs:
                    values = [run['tokensPerSec'] for run in runs]
                else:
                    values = [r['tokensPerSec']]
                box_data.append(values)
    
    # Create horizontal box plot (vert=False)
    bp = ax2.boxplot(box_data, patch_artist=True, tick_labels=box_labels, vert=False)
    
    # Color the boxes
    for patch, color in zip(bp['boxes'], box_colors):
        patch.set_facecolor(color)
        patch.set_alpha(0.7)
    
    # Style the outliers
    for flier in bp['fliers']:
        flier.set(marker='o', color='red', alpha=0.5, markersize=6)
    
    ax2.set_yticklabels(box_labels, fontsize=8)
    ax2.set_xlabel('Tokens per Second', fontsize=11, fontweight='bold')
    ax2.set_title('Tokens/Sec Distribution (Box Plot)\nOutliers shown as red dots', fontsize=12, fontweight='bold')
    ax2.grid(axis='x', alpha=0.3, linestyle='--')
    ax2.set_axisbelow(True)
    
    plt.tight_layout()
    pdf.savefig(fig, dpi=100)
    plt.close()
    
    # --- Second page: TTFT analysis ---
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
    fig.suptitle('Time to First Token (TTFT) Analysis', fontsize=16, fontweight='bold', y=0.98)
    
    # TTFT scatter plot with FLIPPED axes
    all_ttft = []
    y_positions_scatter = []
    colors = []
    
    for protocol in protocols:
        for target in targets:
            results = [r for r in by_protocol[protocol] if r['target'] == target]
            y_base = y_positions[(protocol, target)]
            for r in results:
                runs = r.get('runs', [])
                if not runs:
                    runs = [{'timeToFirstTokenMs': r['timeToFirstTokenMs']}]
                
                for run in runs:
                    all_ttft.append(run['timeToFirstTokenMs'])
                    y_positions_scatter.append(y_base)
                    target_idx = targets.index(target)
                    colors.append(TARGET_COLORS[target_idx % len(TARGET_COLORS)])
    
    jitter = np.random.uniform(-0.15, 0.15, len(y_positions_scatter))
    y_jittered = [y + j for y, j in zip(y_positions_scatter, jitter)]
    
    ax1.scatter(all_ttft, y_jittered, c=colors, alpha=0.6, s=60, edgecolors='black', linewidth=0.5)
    
    # Add mean lines (vertical)
    for protocol in protocols:
        for target in targets:
            results = [r for r in by_protocol[protocol] if r['target'] == target]
            y_base = y_positions[(protocol, target)]
            for r in results:
                mean_val = r['timeToFirstTokenMs']
                ax1.vlines(mean_val, y_base - 0.3, y_base + 0.3, colors='red', linestyles='--', linewidth=2, alpha=0.8)
    
    ax1.set_yticks(range(len(y_labels)))
    ax1.set_yticklabels(y_labels, fontsize=8)
    ax1.set_xlabel('Time to First Token (ms)', fontsize=11, fontweight='bold')
    ax1.set_title('TTFT Distribution (Individual Runs)\nRed line = Mean', fontsize=12, fontweight='bold')
    ax1.grid(axis='x', alpha=0.3, linestyle='--')
    ax1.set_axisbelow(True)
    
    # TTFT horizontal box plot
    box_data = []
    
    for protocol in protocols:
        for target in targets:
            results = [r for r in by_protocol[protocol] if r['target'] == target]
            for r in results:
                runs = r.get('runs', [])
                if runs:
                    values = [run['timeToFirstTokenMs'] for run in runs]
                else:
                    values = [r['timeToFirstTokenMs']]
                box_data.append(values)
    
    bp = ax2.boxplot(box_data, patch_artist=True, tick_labels=box_labels, vert=False)
    
    for patch, color in zip(bp['boxes'], box_colors):
        patch.set_facecolor(color)
        patch.set_alpha(0.7)
    
    for flier in bp['fliers']:
        flier.set(marker='o', color='red', alpha=0.5, markersize=6)
    
    ax2.set_yticklabels(box_labels, fontsize=8)
    ax2.set_xlabel('Time to First Token (ms)', fontsize=11, fontweight='bold')
    ax2.set_title('TTFT Distribution (Box Plot)\nOutliers shown as red dots', fontsize=12, fontweight='bold')
    ax2.grid(axis='x', alpha=0.3, linestyle='--')
    ax2.set_axisbelow(True)
    
    plt.tight_layout()
    pdf.savefig(fig, dpi=100)
    plt.close()


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
    config = data.get('config', None)
    print(f"\n📊 Run ID: {run_id}")
    print_text_report(data, config)
    
    # Create visualizations
    if not args.text_only and MATPLOTLIB_AVAILABLE:
        if args.output:
            output_path = Path(args.output)
        else:
            # Include run ID in output filename
            output_path = Path("reports") / f"benchmark_report_{run_id}.pdf"
            output_path.parent.mkdir(exist_ok=True)
        
        create_visualizations(data, output_path, config)


if __name__ == "__main__":
    main()
