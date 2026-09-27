import pathlib,json,hashlib,urllib.request
root=pathlib.Path(__file__).resolve().parents[2]
p=root/'grammars/manifest.json'; entries=json.loads(p.read_text());commit=entries[0]['commit']
path='extensions/cpp/syntaxes/cpp.embedded.macro.tmLanguage.json'
try:data=urllib.request.urlopen(f'https://raw.githubusercontent.com/microsoft/vscode/{commit}/{path}',timeout=45).read()
except Exception:
 path='extensions/cpp/syntaxes/cpp-grammar-bailout.tmLanguage.json'
 data=urllib.request.urlopen(f'https://raw.githubusercontent.com/microsoft/vscode/{commit}/{path}',timeout=45).read()
g=json.loads(data); (root/'grammars/cpp-macro.json').write_bytes(data)
entries.append(dict(scope=g['scopeName'],repository='https://github.com/microsoft/vscode',commit=commit,path=path,file='cpp-macro.json',sha256=hashlib.sha256(data).hexdigest(),license='MIT',licenseFile='licenses/vscode-ThirdPartyNotices.txt',modifications='none',dependencies=[]))
allowed={e['scope'] for e in entries}
for e in entries:
 file=root/'grammars'/e['file'];g=json.loads(file.read_text());removed=set();deps=set()
 def walk(x):
  if isinstance(x,dict):
   for k,v in list(x.items()):
    if k=='include' and isinstance(v,str) and not v.startswith(('#','$')):
     scope=v.split('#')[0]
     if scope not in allowed:removed.add(scope);x.pop(k)
     else:deps.add(scope)
    else:walk(v)
  elif isinstance(x,list):
   for v in x:walk(v)
 walk(g)
 e['upstreamCommit']=g['version'].rsplit('/',1)[1];e['upstreamRepository']=g['version'].split('/commit/')[0]
 e['upstreamSha256']=e['sha256'];e['dependencies']=sorted(deps)
 if removed:
  file.write_text(json.dumps(g,ensure_ascii=False,indent=2)+'\n');e['modifications']='Removed optional embedded highlighting includes: '+', '.join(sorted(removed))+'. Outer language string scopes retained.'
 e['sha256']=hashlib.sha256(file.read_bytes()).hexdigest()
 e['licenseFile']='licenses/vscode-ThirdPartyNotices.txt'
 e['upstreamNotice']=g.get('information_for_contributors',[])
p.write_text(json.dumps(entries,indent=2)+'\n')
