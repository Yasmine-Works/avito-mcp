#!/usr/bin/env python3
"""Extract only embedded GraphQL documents and public app identity from an APK/XAPK.

No installation, execution, network access, or wholesale resource extraction.
The output deliberately excludes the general DEX string table (which may contain
third-party keys), account data, and binary application code.
"""
import argparse
import hashlib
import io
import json
import re
import struct
import zipfile
from pathlib import Path


def dex_strings(data: bytes):
    if not data.startswith(b"dex\n") or len(data) < 112:
        raise ValueError("Unsupported DEX header")
    if struct.unpack_from("<I", data, 40)[0] != 0x12345678:
        raise ValueError("Unsupported DEX byte order")
    count, offset = struct.unpack_from("<II", data, 56)
    if offset + count * 4 > len(data):
        raise ValueError("Invalid DEX string table")
    for index in range(count):
        position = struct.unpack_from("<I", data, offset + index * 4)[0]
        # The unsigned LEB128 prefix encodes the UTF-16 string length.
        for _ in range(5):
            byte = data[position]
            position += 1
            if byte < 128:
                break
        else:
            raise ValueError("Invalid DEX string length")
        end = data.index(b"\0", position)
        # GraphQL documents here are ASCII. Decode other strings only to filter.
        yield data[position:end].decode("utf-8", errors="replace")


def extract(source: Path) -> dict:
    identity = {}
    with zipfile.ZipFile(source) as archive:
        if "manifest.json" in archive.namelist():
            manifest = json.loads(archive.read("manifest.json"))
            identity = {key: manifest.get(key) for key in
                        ("package_name", "name", "version_name", "version_code")}
            base = next((a["file"] for a in manifest.get("split_apks", [])
                         if a.get("id") == "base"), None)
            if not base:
                raise ValueError("No base APK in XAPK manifest")
            apk = archive.read(base)
        else:
            apk = source.read_bytes()
    operations = {}
    with zipfile.ZipFile(io.BytesIO(apk)) as archive:
        dex_files = sorted(name for name in archive.namelist()
                           if re.fullmatch(r"classes(?:\d+)?\.dex", name))
        for name in dex_files:
            for value in dex_strings(archive.read(name)):
                match = re.match(r"^(query|mutation|subscription) (\w+)[ ({]", value)
                if match and "{" in value:
                    kind, operation = match.groups()
                    existing = operations.get(operation)
                    if existing and existing["document"] != value:
                        raise ValueError(f"Conflicting document: {operation}")
                    operations[operation] = {
                        "kind": kind, "document": value, "dex": name,
                    }
    return {
        "application": identity,
        "baseApkSha256": hashlib.sha256(apk).hexdigest(),
        "method": "Static extraction from DEX string tables; APK not executed",
        "operationCount": len(operations),
        "operations": dict(sorted(operations.items())),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = extract(args.source)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"{result['operationCount']} GraphQL documents extracted to {args.out}")
