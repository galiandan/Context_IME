"""Validate a generated VSIX; defaults to the current Linux x64 Marketplace package."""
import hashlib
import json
import pathlib
import sys
import xml.etree.ElementTree as ET
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
project = json.loads((root / 'package.json').read_text())
path = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else (
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
    if path.stem.endswith('-' + project['publisher']):
        assert archive.read('extension/readme.md').decode() == (root / 'README.marketplace.md').read_text()
    print(json.dumps({
        'path': str(path), 'bytes': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'extensionId': project['publisher'] + '.' + project['name'],
        'files': len(names), 'verified': True,
    }, indent=2))
