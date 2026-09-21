#!/usr/bin/env python3
"""Fail CI on novel potential secrets; permit only exact reviewed source fixtures.

Do not extend allowlist without security review. Never print candidate values.
"""
from pathlib import Path
import json
import sys
import hashlib

root = Path(__file__).resolve().parents[1]
scan_file = Path(sys.argv[1])
scan = json.loads(scan_file.read_text(encoding="utf8"))
results = scan.get("results", {})
known = {
    ("src/multiuser/store.js", "Base64 High Entropy String"):
        ("literal", ("const alphabet = " + chr(39) + "ABCDEFGHJKLMNP" + "QRSTUVWXYZ23456789" + chr(39) + ";")),
    ("tests/call-telemetry-privacy.cjs", "Secret Keyword"):
        ("sha256", ("".join(["7c616da4", "da323160", "e0e69dc7", "b840fde0", "2f8efda6", "63d56e15", "49d307f3", "516242d2"]))),
    ("tests/telemetry-privacy-retention.cjs", "Secret Keyword"):
        ("sha256", ("".join(["7292bff1", "600d90c4", "2d08f5f8", "19dba165", "5093887b", "9b15eea2", "00ba8c6c", "a4cd6412"]))),
}
unreviewed = []
matched = []
for raw_path, alerts in results.items():
    source = raw_path.replace(chr(92), "/").removeprefix("./")
    file_path = root / source
    if not file_path.is_file():
        unreviewed.append({"file": source, "type": "file missing"})
        continue
    lines = file_path.read_text(encoding="utf8").splitlines()
    for alert in alerts:
        kind = alert.get("type", "")
        index = alert.get("line_number", 0) - 1
        line = lines[index] if 0 <= index < len(lines) else ""
        allowed = known.get((source, kind))
        if allowed and ((allowed[0] == 'literal' and line.strip() == allowed[1]) or
                        (allowed[0] == 'sha256' and hashlib.sha256(line.encode()).hexdigest() == allowed[1])):
            matched.append({"file": source, "type": kind})
        else:
            unreviewed.append({"file": source, "type": kind})
if unreviewed:
    print("FAIL_UNREVIEWED_SECRET_CANDIDATES", json.dumps(unreviewed))
    sys.exit(1)
print("PASS_REVIEWED_SECRET_SCAN", "approved_synthetic_findings="+str(len(matched)),
      "unreviewed_findings=0")
