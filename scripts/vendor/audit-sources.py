import urllib.request,json,pathlib,concurrent.futures,hashlib
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'artifacts/reports/reference-sources';out.mkdir(parents=True,exist_ok=True)
def fetch(url):return urllib.request.urlopen(url,timeout=30).read()
def audit(repo):
 result={'repository':repo}
 try:
  commit=json.loads(fetch('https://api.github.com/repos/'+repo+'/commits?per_page=1'))[0]['sha'];result['commit']=commit
  tree=json.loads(fetch(f'https://api.github.com/repos/{repo}/git/trees/{commit}?recursive=1'))['tree']
  paths=[e['path'] for e in tree if e['type']=='blob' and (e['path'].endswith(('.ts','.cpp','.m','.mm','.c','.vala')) or e['path'] in ['LICENSE','package.json']) and not any(p in e['path'] for p in ['node_modules','vendor','test','dist','build'])]
  result['files']=[]
  for path in paths[:16]:
   try:
    data=fetch(f'https://raw.githubusercontent.com/{repo}/{commit}/{path}');local=repo.replace('/','_')+'_'+path.replace('/','_');(out/local).write_bytes(data);result['files'].append({'path':path,'sha256':hashlib.sha256(data).hexdigest(),'local':local})
   except Exception as e:result.setdefault('unverified',[]).append(path+': '+str(e))
 except Exception as e:result['unverified']=str(e)
 return result
repos=['daipeihust/im-select','CI124/auto-ime','zlflly/SmartCursor','fcitx/fcitx5','ibus/ibus']
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:results=list(pool.map(audit,repos))
(root/'docs/reference-audit.json').write_text(json.dumps(results,indent=2)+'\n')
print('Source snapshots saved; manual review required.',[(r['repository'],r.get('commit'),len(r.get('files',[]))) for r in results])
