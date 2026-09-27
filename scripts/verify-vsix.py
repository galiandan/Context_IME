"""Validate a generated VSIX; defaults to the current Linux x64 Marketplace package."""
import hashlib
import json
import pathlib
import sys
import struct
import xml.etree.ElementTree as ET
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
project = json.loads((root / 'package.json').read_text(encoding="utf-8"))
target_arg = sys.argv[2] if len(sys.argv) == 3 and sys.argv[1] == '--target' else None
path = (root / 'artifacts/vsix' / f"{project['name']}-{project['version']}-{target_arg}.vsix") if target_arg else pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else (
    root / 'artifacts/vsix' /
    f"{project['name']}-{project['version']}-linux-x64-{project['publisher']}.vsix"
)
with zipfile.ZipFile(path) as archive:
    names = archive.namelist()
    assert 'extension/dist/extension.js' in names
    assert not any('/node_modules/' in n or '/.tools/' in n or '/artifacts/' in n for n in names)
    grammar_manifest = json.loads(archive.read('extension/grammars/manifest.json'))
    scopes = {entry['scope'] for entry in grammar_manifest}
    for entry in grammar_manifest:
        assert hashlib.sha256(archive.read('extension/grammars/' + entry['file'])).hexdigest() == entry['sha256']
        assert set(entry['dependencies']) <= scopes
        assert 'extension/' + entry['licenseFile'] in names
    resources = json.loads(archive.read('extension/resources/manifest.json'))
    assert hashlib.sha256(archive.read('extension/resources/onig.wasm')).hexdigest() == next(
        entry['sha256'] for entry in resources if entry['name'] == 'onig.wasm'
    )
    manifest = json.loads(archive.read('extension/package.json'))
    assert manifest['extensionKind'] == ['ui'] and 'browser' not in manifest
    for key in ['name', 'version', 'publisher']:
        assert manifest[key] == project[key], key
    assert len(manifest['contributes']['commands']) == 4
    assert archive.read('extension/' + manifest['icon']) == (root / manifest['icon']).read_bytes()
    identity = next(element for element in ET.fromstring(archive.read('extension.vsixmanifest')).iter()
                    if element.tag.endswith('}Identity'))
    assert identity.attrib['Publisher'] == project['publisher']
    target = identity.attrib['TargetPlatform']
    if target_arg:
        assert target == target_arg
    if target.startswith(('win32-', 'darwin-')):
        helper = f"extension/native/bin/{target}/context-ime" + ('.exe' if target.startswith('win32-') else '')
        data = archive.read(helper)
        if target.startswith('win32-'):
            assert data[:2] == b'MZ'
            pe = struct.unpack_from('<I', data, 0x3c)[0]
            assert data[pe:pe+4] == b'PE\0\0'
            machine = struct.unpack_from('<H', data, pe+4)[0]
            assert machine == (0xAA64 if target.endswith('arm64') else 0x8664)
        else:
            assert data[:4] == b'\xcf\xfa\xed\xfe'
            cpu = struct.unpack_from('<I', data, 4)[0]
            assert cpu == (0x0100000c if target.endswith('arm64') else 0x01000007)
        assert len([n for n in names if n.startswith('extension/native/bin/')]) == 1
    if path.stem.endswith('-' + project['publisher']):
        assert archive.read('extension/readme.md').decode() == (root / 'README.marketplace.md').read_text(encoding="utf-8")
    print(json.dumps({
        'path': str(path), 'bytes': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'extensionId': project['publisher'] + '.' + project['name'],
        'files': len(names), 'verified': True,
    }, indent=2))
