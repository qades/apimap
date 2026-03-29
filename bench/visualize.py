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
    """Create matplotlib visualizations - 1 page per concurrency-protocol combination."""
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
            
            # --- Latency subplot ---
            if lat_results:
                metrics = ['mean', 'p95', 'p99']
                metric_labels = ['Mean', 'P95', 'P99']
                x = np.arange(len(metrics))
                width = 0.8 / len(targets)
                
                for i, target in enumerate(targets):
                    target_lats = [r for r in lat_results if r['target'] == target]
                    if target_lats:
                        stats = calculate_stats(target_lats[0].get('latencies', []))
                        values = [stats[m] for m in metrics]
                        offset = width * (i - (len(targets) - 1) / 2)
                        bars = ax1.bar(x + offset, values, width, label=target,
                                      color=TARGET_COLORS[i % len(TARGET_COLORS)],
                                      edgecolor='black', linewidth=1.2)
                        for bar in bars:
                            height = bar.get_height()
                            ax1.text(bar.get_x() + bar.get_width()/2., height,
                                   f'{height:.1f}',
                                   ha='center', va='bottom', fontsize=8)
                
                ax1.set_ylabel('Milliseconds (ms)', fontsize=11, fontweight='bold')
                ax1.set_title('Latency (Lower is Better)', fontsize=12, fontweight='bold')
                ax1.set_xticks(x)
                ax1.set_xticklabels(metric_labels)
                ax1.legend(fontsize=10)
                ax1.grid(axis='y', alpha=0.3, linestyle='--')
                ax1.set_axisbelow(True)
            
            # --- Throughput subplot ---
            if tp_results:
                target_throughputs = []
                target_labels = []
                target_colors = []
                
                for i, target in enumerate(targets):
                    target_tp = [r for r in tp_results if r['target'] == target]
                    if target_tp:
                        target_throughputs.append(target_tp[0]['requestsPerSecond'])
                        target_labels.append(target)
                        target_colors.append(TARGET_COLORS[i % len(TARGET_COLORS)])
                
                if target_throughputs:
                    x = np.arange(len(target_labels))
                    bars = ax2.bar(x, target_throughputs, color=target_colors,
                                  edgecolor='black', linewidth=1.2, width=0.6)
                    for bar in bars:
                        height = bar.get_height()
                        ax2.text(bar.get_x() + bar.get_width()/2., height,
                               f'{height:.1f}',
                               ha='center', va='bottom', fontsize=9)
                    
                    ax2.set_ylabel('Requests per Second', fontsize=11, fontweight='bold')
                    ax2.set_title('Throughput (Higher is Better)', fontsize=12, fontweight='bold')
                    ax2.set_xticks(x)
                    ax2.set_xticklabels(target_labels, fontsize=10)
                    ax2.grid(axis='y', alpha=0.3, linestyle='--')
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
    """Create a streaming performance summary page."""
    fig, ax = plt.subplots(figsize=(12, 6))
    
    # Group by protocol
    by_protocol = {}
    for r in streaming_data:
        protocol = r.get('protocol', 'Unknown')
        if protocol not in by_protocol:
            by_protocol[protocol] = []
        by_protocol[protocol].append(r)
    
    protocols = sorted(by_protocol.keys())
    targets = sorted(set(r['target'] for r in streaming_data))
    
    x = np.arange(len(protocols))
    width = 0.35
    
    # Plot tokens/sec by protocol for each target
    for i, target in enumerate(targets):
        values = []
        for protocol in protocols:
            results = [r for r in by_protocol[protocol] if r['target'] == target]
            if results:
                values.append(results[0]['tokensPerSec'])
            else:
                values.append(0)
        
        offset = width * (i - (len(targets) - 1) / 2)
        bars = ax.bar(x + offset, values, width, label=target,
                     color=TARGET_COLORS[i % len(TARGET_COLORS)],
                     edgecolor='black', linewidth=1.2)
        for bar in bars:
            height = bar.get_height()
            if height > 0:
                ax.text(bar.get_x() + bar.get_width()/2., height,
                       f'{height:.0f}',
                       ha='center', va='bottom', fontsize=8)
    
    ax.set_ylabel('Tokens per Second', fontsize=12, fontweight='bold')
    ax.set_title('Streaming Performance by Protocol (Higher is Better)', 
                fontsize=14, fontweight='bold', pad=20)
    ax.set_xticks(x)
    ax.set_xticklabels(protocols, rotation=45, ha='right', fontsize=10)
    ax.legend(fontsize=11)
    ax.grid(axis='y', alpha=0.3, linestyle='--')
    ax.set_axisbelow(True)
    
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
