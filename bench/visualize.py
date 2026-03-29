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

# Color palette for contenders (supports up to 5 targets)
CONTENDER_COLORS = ['#4a90d9', '#d94a4a', '#4ad94a', '#d94ad9', '#d9a34a']

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


def get_target_endpoint(protocol_description: str) -> str:
    """Extract target endpoint from protocol description (e.g., 'OpenAI→Anthropic' -> 'Anthropic')."""
    if '→' in protocol_description:
        return protocol_description.split('→')[1]
    return protocol_description


def get_source_protocol(protocol_description: str) -> str:
    """Extract source protocol from protocol description (e.g., 'OpenAI→Anthropic' -> 'OpenAI')."""
    if '→' in protocol_description:
        return protocol_description.split('→')[0]
    return protocol_description


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


def group_by_target_endpoint(results: list, config: dict) -> dict:
    """Group results by target endpoint (e.g., 'Anthropic', 'OpenAI')."""
    grouped = {}
    for r in results:
        scenario = r.get('scenario', '')
        protocol = get_protocol_from_scenario(scenario, config)
        target_endpoint = get_target_endpoint(protocol)
        if target_endpoint not in grouped:
            grouped[target_endpoint] = []
        grouped[target_endpoint].append(r)
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


def create_visualizations(data: dict, output_path: Path, config: dict = None):
    """Create matplotlib visualizations - 1 page per target endpoint @ concurrency combination.
    
    Layout: Grouped by target endpoint first, then contenders for easy transformation comparison.
    Uses box plots to show distribution across all protocol combinations.
    """
    if not MATPLOTLIB_AVAILABLE:
        return
    
    if config is None:
        config = data.get('config', {})
    
    with PdfPages(output_path) as pdf:
        latency_data = data.get('latency', [])
        throughput_data = data.get('throughput', [])
        
        # Group by (target_endpoint, concurrency)
        latency_grouped = {}
        throughput_grouped = {}
        
        for r in latency_data:
            scenario_name = r.get('scenario', '')
            concurrency = get_scenario_concurrency(scenario_name, config)
            protocol = get_protocol_from_scenario(scenario_name, config)
            target_endpoint = get_target_endpoint(protocol)
            key = (target_endpoint, concurrency)
            if key not in latency_grouped:
                latency_grouped[key] = []
            latency_grouped[key].append(r)
        
        for r in throughput_data:
            scenario_name = r.get('scenario', '')
            concurrency = get_scenario_concurrency(scenario_name, config)
            protocol = get_protocol_from_scenario(scenario_name, config)
            target_endpoint = get_target_endpoint(protocol)
            key = (target_endpoint, concurrency)
            if key not in throughput_grouped:
                throughput_grouped[key] = []
            throughput_grouped[key].append(r)
        
        # Get all unique (target_endpoint, concurrency) combinations
        all_keys = sorted(set(list(latency_grouped.keys()) + list(throughput_grouped.keys())))
        
        # Page per (target_endpoint, concurrency) combination
        for target_endpoint, concurrency in all_keys:
            lat_results = latency_grouped.get((target_endpoint, concurrency), [])
            tp_results = throughput_grouped.get((target_endpoint, concurrency), [])
            
            if not lat_results and not tp_results:
                continue
            
            # Get contenders (targets)
            contenders = sorted(set(r['target'] for r in lat_results + tp_results))
            if not contenders:
                continue
            
            # Create figure with 2 subplots (latency and throughput)
            fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
            fig.suptitle(f'{target_endpoint} @ {concurrency} Concurrent Requests', 
                        fontsize=16, fontweight='bold', y=0.98)
            
            # --- Latency subplot (horizontal box plots) ---
            if lat_results:
                # Aggregate all latencies per contender across all protocol combinations
                latency_box_data = []
                latency_box_labels = []
                latency_box_colors = []
                
                for contender in contenders:
                    target_results = [r for r in lat_results if r['target'] == contender]
                    # Collect all latencies from all protocol combinations
                    all_latencies = []
                    for r in target_results:
                        all_latencies.extend(r.get('latencies', []))
                    
                    if all_latencies:
                        latency_box_data.append(all_latencies)
                        latency_box_labels.append(contender)
                        contender_idx = contenders.index(contender)
                        latency_box_colors.append(CONTENDER_COLORS[contender_idx % len(CONTENDER_COLORS)])
                
                if latency_box_data:
                    bp = ax1.boxplot(latency_box_data, patch_artist=True, tick_labels=latency_box_labels, vert=False)
                    
                    for patch, color in zip(bp['boxes'], latency_box_colors):
                        patch.set_facecolor(color)
                        patch.set_alpha(0.7)
                    
                    for whisker in bp['whiskers']:
                        whisker.set(color='gray', linewidth=1.5)
                    
                    for cap in bp['caps']:
                        cap.set(color='gray', linewidth=1.5)
                    
                    for median in bp['medians']:
                        median.set(color='red', linewidth=2)
                    
                    for flier in bp['fliers']:
                        flier.set(marker='o', color='red', alpha=0.5, markersize=4)
                    
                    # Add mean values as text annotations
                    for i, (lat_data, label) in enumerate(zip(latency_box_data, latency_box_labels)):
                        mean_val = mean(lat_data)
                        ax1.text(mean_val, i + 1.15, f' μ={mean_val:.1f}', 
                                ha='center', va='bottom', fontsize=8, color='darkred')
                    
                    ax1.set_xlabel('Milliseconds (ms)', fontsize=11, fontweight='bold')
                    ax1.set_title('Latency Distribution (Lower is Better)\nBox: Q1-Q3, Line: Median, Red μ: Mean', 
                                 fontsize=11, fontweight='bold')
                    ax1.grid(axis='x', alpha=0.3, linestyle='--')
                    ax1.set_axisbelow(True)
            
            # --- Throughput subplot (horizontal box plots) ---
            if tp_results:
                # Aggregate throughput values per contender across all protocol combinations
                throughput_box_data = []
                throughput_box_labels = []
                throughput_box_colors = []
                
                for contender in contenders:
                    target_results = [r for r in tp_results if r['target'] == contender]
                    # Collect throughput values from all protocol combinations
                    values = [r['requestsPerSecond'] for r in target_results]
                    
                    if values:
                        throughput_box_data.append(values)
                        throughput_box_labels.append(contender)
                        contender_idx = contenders.index(contender)
                        throughput_box_colors.append(CONTENDER_COLORS[contender_idx % len(CONTENDER_COLORS)])
                
                if throughput_box_data:
                    bp = ax2.boxplot(throughput_box_data, patch_artist=True, tick_labels=throughput_box_labels, vert=False)
                    
                    for patch, color in zip(bp['boxes'], throughput_box_colors):
                        patch.set_facecolor(color)
                        patch.set_alpha(0.7)
                    
                    for whisker in bp['whiskers']:
                        whisker.set(color='gray', linewidth=1.5)
                    
                    for cap in bp['caps']:
                        cap.set(color='gray', linewidth=1.5)
                    
                    for median in bp['medians']:
                        median.set(color='red', linewidth=2)
                    
                    for flier in bp['fliers']:
                        flier.set(marker='o', color='red', alpha=0.5, markersize=4)
                    
                    # Add mean values as text annotations
                    for i, (tp_data, label) in enumerate(zip(throughput_box_data, throughput_box_labels)):
                        mean_val = mean(tp_data)
                        ax2.text(mean_val, i + 1.15, f' μ={mean_val:.1f}', 
                                ha='center', va='bottom', fontsize=8, color='darkred')
                    
                    ax2.set_xlabel('Requests per Second', fontsize=11, fontweight='bold')
                    ax2.set_title('Throughput Distribution (Higher is Better)\nBox: Q1-Q3, Line: Median, Red μ: Mean', 
                                 fontsize=11, fontweight='bold')
                    ax2.grid(axis='x', alpha=0.3, linestyle='--')
                    ax2.set_axisbelow(True)
            
            plt.tight_layout(rect=[0, 0, 1, 0.96])  # Make room for suptitle
            pdf.savefig(fig, dpi=100)
            plt.close()
        
        # Fallback chart if no config grouping available
        if not all_keys and throughput_data:
            scenarios = sorted(set(r['scenario'] for r in throughput_data))
            contenders_in_data = sorted(set(r['target'] for r in throughput_data))
            num_contenders = len(contenders_in_data)
            
            fig, ax = plt.subplots(figsize=(12, 6))
            x = np.arange(len(scenarios))
            width = 0.8 / num_contenders
            
            for i, contender in enumerate(contenders_in_data):
                throughputs = []
                for scenario in scenarios:
                    value = 0
                    for r in throughput_data:
                        if r['target'] == contender and r['scenario'] == scenario:
                            value = r['requestsPerSecond']
                            break
                    throughputs.append(value)
                
                offset = width * (i - (num_contenders - 1) / 2)
                bars = ax.bar(x + offset, throughputs, width, label=contender,
                             color=CONTENDER_COLORS[i % len(CONTENDER_COLORS)], edgecolor='black', linewidth=1.2)
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
    
    print(f"📊 Visualizations saved to: {output_path}")


def create_streaming_summary_page(pdf, streaming_data: list):
    """Create streaming performance summary pages with box plots.
    
    Grouped by: Contender and Source Protocol (consolidating all target protocols).
    """
    # Group streaming data by (contender, source_protocol)
    grouped_data = {}
    
    for r in streaming_data:
        contender = r.get('target', 'Unknown')
        protocol = r.get('protocol', 'OpenAI→OpenAI')
        source_protocol = get_source_protocol(protocol)
        
        key = (contender, source_protocol)
        if key not in grouped_data:
            grouped_data[key] = {
                'tokens_per_sec': [],
                'ttft': [],
                'runs': []
            }
        
        # Collect all run data
        runs = r.get('runs', [])
        if runs:
            for run in runs:
                grouped_data[key]['tokens_per_sec'].append(run.get('tokensPerSec', 0))
                grouped_data[key]['ttft'].append(run.get('timeToFirstTokenMs', 0))
        else:
            # Use aggregated values if no individual runs
            grouped_data[key]['tokens_per_sec'].append(r.get('tokensPerSec', 0))
            grouped_data[key]['ttft'].append(r.get('timeToFirstTokenMs', 0))
        
        grouped_data[key]['runs'].append(r)
    
    if not grouped_data:
        return
    
    # Sort keys for consistent ordering
    sorted_keys = sorted(grouped_data.keys())
    contenders = sorted(set(k[0] for k in sorted_keys))
    source_protocols = sorted(set(k[1] for k in sorted_keys))
    
    # --- Page 1: Tokens per Second Analysis ---
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
    fig.suptitle('Streaming Performance: Tokens per Second', fontsize=16, fontweight='bold', y=0.98)
    
    # Build Y-axis positions: group by contender, then source protocol within each contender
    y_positions = {}
    y_labels = []
    box_colors = []
    y_pos = 0
    
    for contender in contenders:
        for source_protocol in source_protocols:
            key = (contender, source_protocol)
            if key in grouped_data:
                y_positions[key] = y_pos
                y_labels.append(f"{contender} | {source_protocol}")
                contender_idx = contenders.index(contender)
                box_colors.append(CONTENDER_COLORS[contender_idx % len(CONTENDER_COLORS)])
                y_pos += 1
    
    # --- Left plot: Scatter plot of individual runs ---
    all_tokens_per_sec = []
    y_positions_scatter = []
    colors = []
    
    for contender in contenders:
        for source_protocol in source_protocols:
            key = (contender, source_protocol)
            if key not in grouped_data:
                continue
            data = grouped_data[key]
            y_base = y_positions[key]
            
            for value in data['tokens_per_sec']:
                all_tokens_per_sec.append(value)
                y_positions_scatter.append(y_base)
                contender_idx = contenders.index(contender)
                colors.append(CONTENDER_COLORS[contender_idx % len(CONTENDER_COLORS)])
    
    # Create jitter on Y-axis for better visibility
    jitter = np.random.uniform(-0.15, 0.15, len(y_positions_scatter))
    y_jittered = [y + j for y, j in zip(y_positions_scatter, jitter)]
    
    ax1.scatter(all_tokens_per_sec, y_jittered, c=colors, alpha=0.6, s=60, edgecolors='black', linewidth=0.5)
    
    # Add mean lines
    for contender in contenders:
        for source_protocol in source_protocols:
            key = (contender, source_protocol)
            if key not in grouped_data:
                continue
            data = grouped_data[key]
            y_base = y_positions[key]
            if data['tokens_per_sec']:
                mean_val = mean(data['tokens_per_sec'])
                ax1.vlines(mean_val, y_base - 0.3, y_base + 0.3, colors='red', linestyles='--', linewidth=2, alpha=0.8)
    
    ax1.set_yticks(range(len(y_labels)))
    ax1.set_yticklabels(y_labels, fontsize=8)
    ax1.set_xlabel('Tokens per Second', fontsize=11, fontweight='bold')
    ax1.set_title('Tokens/Sec Distribution (Individual Runs)\nRed line = Mean', fontsize=12, fontweight='bold')
    ax1.grid(axis='x', alpha=0.3, linestyle='--')
    ax1.set_axisbelow(True)
    
    # --- Right plot: Horizontal box plot ---
    box_data = []
    box_labels_filtered = []
    box_colors_filtered = []
    
    for contender in contenders:
        for source_protocol in source_protocols:
            key = (contender, source_protocol)
            if key not in grouped_data:
                continue
            data = grouped_data[key]
            if data['tokens_per_sec']:
                box_data.append(data['tokens_per_sec'])
                box_labels_filtered.append(f"{contender} | {source_protocol}")
                contender_idx = contenders.index(contender)
                box_colors_filtered.append(CONTENDER_COLORS[contender_idx % len(CONTENDER_COLORS)])
    
    if box_data:
        bp = ax2.boxplot(box_data, patch_artist=True, tick_labels=box_labels_filtered, vert=False)
        
        for patch, color in zip(bp['boxes'], box_colors_filtered):
            patch.set_facecolor(color)
            patch.set_alpha(0.7)
        
        for flier in bp['fliers']:
            flier.set(marker='o', color='red', alpha=0.5, markersize=6)
        
        ax2.set_yticklabels(box_labels_filtered, fontsize=8)
        ax2.set_xlabel('Tokens per Second', fontsize=11, fontweight='bold')
        ax2.set_title('Tokens/Sec Distribution (Box Plot)\nOutliers shown as red dots', fontsize=12, fontweight='bold')
        ax2.grid(axis='x', alpha=0.3, linestyle='--')
        ax2.set_axisbelow(True)
    
    plt.tight_layout()
    pdf.savefig(fig, dpi=100)
    plt.close()
    
    # --- Page 2: TTFT Analysis ---
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
    fig.suptitle('Time to First Token (TTFT) Analysis', fontsize=16, fontweight='bold', y=0.98)
    
    # TTFT scatter plot
    all_ttft = []
    y_positions_scatter = []
    colors = []
    
    for contender in contenders:
        for source_protocol in source_protocols:
            key = (contender, source_protocol)
            if key not in grouped_data:
                continue
            data = grouped_data[key]
            y_base = y_positions[key]
            
            for value in data['ttft']:
                all_ttft.append(value)
                y_positions_scatter.append(y_base)
                contender_idx = contenders.index(contender)
                colors.append(CONTENDER_COLORS[contender_idx % len(CONTENDER_COLORS)])
    
    jitter = np.random.uniform(-0.15, 0.15, len(y_positions_scatter))
    y_jittered = [y + j for y, j in zip(y_positions_scatter, jitter)]
    
    ax1.scatter(all_ttft, y_jittered, c=colors, alpha=0.6, s=60, edgecolors='black', linewidth=0.5)
    
    # Add mean lines
    for contender in contenders:
        for source_protocol in source_protocols:
            key = (contender, source_protocol)
            if key not in grouped_data:
                continue
            data = grouped_data[key]
            y_base = y_positions[key]
            if data['ttft']:
                mean_val = mean(data['ttft'])
                ax1.vlines(mean_val, y_base - 0.3, y_base + 0.3, colors='red', linestyles='--', linewidth=2, alpha=0.8)
    
    ax1.set_yticks(range(len(y_labels)))
    ax1.set_yticklabels(y_labels, fontsize=8)
    ax1.set_xlabel('Time to First Token (ms)', fontsize=11, fontweight='bold')
    ax1.set_title('TTFT Distribution (Individual Runs)\nRed line = Mean', fontsize=12, fontweight='bold')
    ax1.grid(axis='x', alpha=0.3, linestyle='--')
    ax1.set_axisbelow(True)
    
    # TTFT horizontal box plot
    box_data = []
    box_labels_filtered = []
    box_colors_filtered = []
    
    for contender in contenders:
        for source_protocol in source_protocols:
            key = (contender, source_protocol)
            if key not in grouped_data:
                continue
            data = grouped_data[key]
            if data['ttft']:
                box_data.append(data['ttft'])
                box_labels_filtered.append(f"{contender} | {source_protocol}")
                contender_idx = contenders.index(contender)
                box_colors_filtered.append(CONTENDER_COLORS[contender_idx % len(CONTENDER_COLORS)])
    
    if box_data:
        bp = ax2.boxplot(box_data, patch_artist=True, tick_labels=box_labels_filtered, vert=False)
        
        for patch, color in zip(bp['boxes'], box_colors_filtered):
            patch.set_facecolor(color)
            patch.set_alpha(0.7)
        
        for flier in bp['fliers']:
            flier.set(marker='o', color='red', alpha=0.5, markersize=6)
        
        ax2.set_yticklabels(box_labels_filtered, fontsize=8)
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
