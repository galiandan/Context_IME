"""Build-time acquisition only. Runtime is fully offline."""
import urllib.request,json,pathlib,hashlib
root=pathlib.Path(__file__).resolve().parents[2]

def get(url):
    return urllib.request.urlopen(url,timeout=60).read()
repo='microsoft/vscode'
commit='f1a4fb101478ce6ec82fe9627c43efbf9e98c813'
files={'python':'python','javascript':'javascript','typescript':'typescript-basics','c':'cpp','cpp':'cpp'}
manifest=[]
for lang,folder in files.items():
    name={'python':'MagicPython','javascript':'JavaScript','typescript':'TypeScript','c':'c','cpp':'cpp'}[lang]+'.tmLanguage.json'
    path=f'extensions/{folder}/syntaxes/{name}'
    data=get(f'https://raw.githubusercontent.com/{repo}/{commit}/{path}')
    (root/'grammars'/f'{lang}.json').write_bytes(data)
    grammar=json.loads(data)
    includes=set()
    def walk(x):
        if isinstance(x,dict):
            for k,v in x.items():
                if k=='include' and isinstance(v,str) and not v.startswith(('#','$')): includes.add(v.split('#')[0])
                walk(v)
        elif isinstance(x,list):
            for v in x: walk(v)
    walk(grammar)
    manifest.append(dict(language=lang,scope=grammar['scopeName'],repository=f'https://github.com/{repo}',commit=commit,path=path,file=f'{lang}.json',sha256=hashlib.sha256(data).hexdigest(),dependencies=sorted(includes),license='MIT',licenseFile='licenses/vscode-LICENSE.txt',modifications='none'))
(root/'grammars/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(root/'licenses/vscode-LICENSE.txt').write_bytes(get(f'https://raw.githubusercontent.com/{repo}/{commit}/LICENSE.txt'))
(root/'licenses/vscode-ThirdPartyNotices.txt').write_bytes(get(f'https://raw.githubusercontent.com/{repo}/{commit}/ThirdPartyNotices.txt'))
print(json.dumps(manifest,indent=2))
