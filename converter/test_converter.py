#!/usr/bin/env python3
"""
test_converter.py — standalone test harness for FastExams converter.
Must be run from inside the converter venv.

Usage:
  python test_converter.py                    # Test against live server (localhost:8001)
  python test_converter.py --direct           # Test convert_pdf_or_pptx() directly
  python test_converter.py --save-output      # Save markdown output to output_test/
  python test_converter.py --url http://host  # Custom converter URL
"""
import argparse
import sys
import time
import traceback
from pathlib import Path

import requests

INPUT_DIR = Path(__file__).parent / "input_test"
OUTPUT_DIR = Path(__file__).parent / "output_test"
SUBFOLDERS = ["past_exams", "theorical_material"]


def run_server_mode(args):
    """Test against live converter server."""
    base_url = args.url.rstrip("/")

    # Health check
    print(f"\n=== Health Check: {base_url}/health ===")
    try:
        r = requests.get(f"{base_url}/health", timeout=5)
        r.raise_for_status()
        health = r.json()
        print(f"  status     : {health.get('status')}")
        print(f"  markitdown : {health.get('markitdown')}")
        print(f"  docling    : {health.get('docling')}")
    except Exception:
        print("FAIL — server not reachable. Start it with: uvicorn main:app --reload --port 8001")
        traceback.print_exc()
        sys.exit(1)

    results = []
    for subfolder in SUBFOLDERS:
        folder = INPUT_DIR / subfolder
        if not folder.exists():
            print(f"\nWARN: {folder} not found, skipping")
            continue
        pdfs = sorted(folder.glob("*.pdf")) + sorted(folder.glob("*.pptx"))
        for pdf in pdfs:
            result = test_file_server(base_url, pdf, subfolder, args.save_output)
            results.append(result)

    print_results(results)


def test_file_server(base_url, path, subfolder, save_output):
    """Test a single file via HTTP."""
    file_type = path.suffix.lstrip(".").lower()
    print(f"\n--- {subfolder}/{path.name} ---")
    t0 = time.monotonic()
    try:
        with open(path, "rb") as f:
            resp = requests.post(
                f"{base_url}/convert",
                files={"file": (path.name, f, "application/octet-stream")},
                data={"file_type": file_type},
                timeout=300,  # 5 min for large PDFs
            )
        elapsed = time.monotonic() - t0

        if not resp.ok:
            print(f"  FAIL — HTTP {resp.status_code}")
            try:
                error_text = resp.json().get("detail", resp.text[:200])
            except Exception:
                error_text = resp.text[:200]
            print(f"  {error_text}")
            return dict(
                name=path.name,
                subfolder=subfolder,
                status="FAIL",
                error=f"HTTP {resp.status_code}",
                elapsed=elapsed,
            )

        data = resp.json()
        return evaluate_and_print(data, path, subfolder, elapsed, save_output)

    except Exception as e:
        elapsed = time.monotonic() - t0
        print(f"  FAIL — Exception after {elapsed:.1f}s:")
        traceback.print_exc()
        return dict(
            name=path.name,
            subfolder=subfolder,
            status="FAIL",
            error=str(e),
            elapsed=elapsed,
        )


def run_direct_mode(args):
    """Test convert_pdf_or_pptx() directly without server."""
    sys.path.insert(0, str(Path(__file__).parent))
    try:
        from main import convert_pdf_or_pptx
    except ImportError as e:
        print(f"FAIL — Cannot import main.py: {e}")
        traceback.print_exc()
        sys.exit(1)

    print("\n=== Direct Mode (no server) ===")
    results = []
    for subfolder in SUBFOLDERS:
        folder = INPUT_DIR / subfolder
        if not folder.exists():
            continue
        pdfs = sorted(folder.glob("*.pdf")) + sorted(folder.glob("*.pptx"))
        for pdf in pdfs:
            file_type = pdf.suffix.lstrip(".").lower()
            print(f"\n--- {subfolder}/{pdf.name} ---")
            t0 = time.monotonic()
            try:
                data = convert_pdf_or_pptx(pdf.read_bytes(), file_type)
                elapsed = time.monotonic() - t0
                results.append(
                    evaluate_and_print(data, pdf, subfolder, elapsed, args.save_output)
                )
            except Exception as e:
                elapsed = time.monotonic() - t0
                print(f"  FAIL — Exception after {elapsed:.1f}s:")
                traceback.print_exc()
                results.append(
                    dict(
                        name=pdf.name,
                        subfolder=subfolder,
                        status="FAIL",
                        error=str(e),
                        elapsed=elapsed,
                    )
                )
    print_results(results)


def evaluate_and_print(data, path, subfolder, elapsed, save_output):
    """Evaluate conversion result and print stats."""
    md = data.get("markdown", "")
    char_count = len(md)
    page_count = md.count("\n---\n") + 1 if md else 0
    avg_chars = char_count // max(page_count, 1)
    converter_used = data.get("converter_used", "unknown")
    docling_error = data.get("docling_error")
    status = "PASS" if char_count > 0 else "FAIL"

    print(f"  status       : {status}")
    print(f"  converter    : {converter_used}")
    if docling_error:
        print(f"  docling err  : {docling_error[:100]}")
    print(f"  chars        : {char_count:,}")
    print(f"  pages est.   : {page_count}")
    print(f"  avg chars/pg : {avg_chars:,}")
    print(f"  elapsed      : {elapsed:.1f}s")

    if save_output and char_count > 0:
        out_dir = OUTPUT_DIR / subfolder
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / (path.stem + ".md")
        out_file.write_text(md, encoding="utf-8")
        print(f"  saved to     : {out_file.relative_to(Path.cwd())}")

    return dict(
        name=path.name,
        subfolder=subfolder,
        status=status,
        converter_used=converter_used,
        chars=char_count,
        pages=page_count,
        avg_chars=avg_chars,
        elapsed=elapsed,
        error=None,
    )


def print_results(results):
    """Print summary table."""
    print("\n" + "=" * 80)
    print(
        f"{'FILE':<45} {'STATUS':<6} {'CONV':<15} {'CHARS':>12} {'PG':>4} {'SEC':>6}"
    )
    print("-" * 80)
    for r in results:
        name = r["name"][:44]
        print(
            f"{name:<45} {r['status']:<6} {r.get('converter_used', ''):<15} "
            f"{r.get('chars', 0):>12,} {r.get('pages', 0):>4} {r.get('elapsed', 0):>6.1f}"
        )
        if r.get("error"):
            print(f"  ERROR: {r['error'][:70]}")

    passed = sum(1 for r in results if r["status"] == "PASS")
    failed = len(results) - passed
    print("=" * 80)
    print(f"TOTAL: {len(results)} files — {passed} PASSED, {failed} FAILED")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test FastExams converter")
    parser.add_argument(
        "--direct",
        action="store_true",
        help="Call convert_pdf_or_pptx() directly (no server)",
    )
    parser.add_argument(
        "--url",
        default="http://localhost:8001",
        help="Converter server URL (default: http://localhost:8001)",
    )
    parser.add_argument(
        "--save-output",
        action="store_true",
        help="Save markdown output to output_test/",
    )
    args = parser.parse_args()

    if args.direct:
        run_direct_mode(args)
    else:
        run_server_mode(args)
