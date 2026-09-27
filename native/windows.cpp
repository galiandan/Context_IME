#define UNICODE
#define _UNICODE
#include <windows.h>
#include <string>
#include <vector>
#include <iostream>
#include <algorithm>
#include <cstdint>
#include <cwchar>
#include <set>
// Original implementation. Only layout identity is supported, NOT TSF profile or conversion mode.
static std::wstring arg(int argc,wchar_t**argv,const std::wstring&key){for(int i=2;i+1<argc;i++)if(argv[i]==key)return argv[i+1];return L"";}
static int fail(){std::cout<<"{\"version\":1,\"status\":\"failed\"}\n";return 1;}
static std::wstring klid(HKL layout){
 // Map loaded HKL to a registry KLID without activating any layout in the helper.
 // Fxxx handles encode the registry Layout Id; ambiguous mappings are unsupported.
 DWORD raw=static_cast<DWORD>(reinterpret_cast<uintptr_t>(layout));
 WORD language=LOWORD(raw),device=HIWORD(raw);wchar_t key[9]={};
 HKEY base=nullptr;if(RegOpenKeyExW(HKEY_LOCAL_MACHINE,L"SYSTEM\\CurrentControlSet\\Control\\Keyboard Layouts",0,KEY_READ,&base)!=ERROR_SUCCESS)return L"";
 if(device==language||device==0||((device&0xF000)==0xE000)){
  swprintf_s(key,L"%08X",(device==language||device==0)?static_cast<DWORD>(language):raw);
  HKEY item=nullptr;bool exists=RegOpenKeyExW(base,key,0,KEY_READ,&item)==ERROR_SUCCESS;if(item)RegCloseKey(item);RegCloseKey(base);return exists?key:L"";
 }
 std::wstring match;
 if((device&0xF000)==0xF000)for(DWORD index=0;;index++){
  wchar_t name[256];DWORD length=256;if(RegEnumKeyExW(base,index,name,&length,nullptr,nullptr,nullptr,nullptr)!=ERROR_SUCCESS)break;
  wchar_t* end=nullptr;unsigned long value=wcstoul(name,&end,16);if(length!=8||*end||LOWORD(value)!=language)continue;
  HKEY item=nullptr;if(RegOpenKeyExW(base,name,0,KEY_READ,&item)!=ERROR_SUCCESS)continue;
  wchar_t id[33]={};DWORD bytes=sizeof(id)-sizeof(wchar_t),type=0;LONG result=RegQueryValueExW(item,L"Layout Id",nullptr,&type,reinterpret_cast<BYTE*>(id),&bytes);RegCloseKey(item);
  wchar_t* idEnd=nullptr;unsigned long layoutId=wcstoul(id,&idEnd,16);
  if(result==ERROR_SUCCESS&&type==REG_SZ&&idEnd!=id&&*idEnd==0&&layoutId==(device&0x0FFF)){if(!match.empty()){match.clear();break;}match=name;}
 }
 RegCloseKey(base);return match;
}
static HWND target(const std::wstring&expected){
 HWND hwnd=GetForegroundWindow();DWORD pid=0;GetWindowThreadProcessId(hwnd,&pid);
 HANDLE p=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid);if(!p)return nullptr;
 wchar_t path[32768];DWORD size=32768;BOOL ok=QueryFullProcessImageNameW(p,0,path,&size);CloseHandle(p);
 if(!ok||_wcsicmp(expected.c_str(),path)!=0||GetForegroundWindow()!=hwnd)return nullptr;
 GUITHREADINFO info{};info.cbSize=sizeof(info);
 if(!GetGUIThreadInfo(0,&info)||!info.hwndFocus||GetAncestor(info.hwndFocus,GA_ROOT)!=hwnd)return nullptr;
 DWORD focusPid=0;GetWindowThreadProcessId(info.hwndFocus,&focusPid);
 if(focusPid!=pid||GetForegroundWindow()!=hwnd)return nullptr;
 return info.hwndFocus;
}
int wmain(int argc,wchar_t**argv){
 if(argc<2)return fail();std::wstring op=argv[1];auto app=arg(argc,argv,L"--app");
 if(op!=L"get"&&op!=L"probe"&&op!=L"target"&&op!=L"list"&&op!=L"set")return fail();
 std::set<std::wstring> keys;
 if(argc%2!=0)return fail();
 for(int i=2;i<argc;i+=2){
  std::wstring key=argv[i];
  if((key!=L"--app"&&key!=L"--source"&&key!=L"--target")||!keys.insert(key).second||!argv[i+1][0])return fail();
 }
 if(keys!=(op==L"set"?std::set<std::wstring>{L"--app",L"--source",L"--target"}:std::set<std::wstring>{L"--app"}))return fail();
 std::vector<HKL> layouts;
 if(op==L"list"||op==L"set"){
  int count=GetKeyboardLayoutList(0,nullptr);if(count<=0||count>512)return fail();
  layouts.resize(count);int copied=GetKeyboardLayoutList(count,layouts.data());
  if(copied<=0||copied>count)return fail();layouts.resize(copied);
 }
 if(op==L"list"){
  std::wcout<<L"{\"version\":1,\"sources\":[";bool first=true;std::set<std::wstring> seen;
  for(auto h:layouts){auto id=klid(h);if(id.empty()||!seen.insert(id).second)continue;if(!first)std::wcout<<L",";first=false;std::wcout<<L"\"klid:"<<id<<L"\"";}
  std::wcout<<L"]}\n";return 0;
 }
 HWND hwnd=target(app);if(!hwnd)return fail();DWORD pid=0;DWORD thread=GetWindowThreadProcessId(hwnd,&pid);if(!thread||!pid)return fail();
 std::wstring token=std::to_wstring(reinterpret_cast<uintptr_t>(hwnd))+L":"+std::to_wstring(pid)+L":"+std::to_wstring(thread);
 if(op==L"target"){std::wcout<<L"{\"version\":1,\"target\":\""<<token<<L"\"}\n";return 0;}
 if(op==L"set"){
  if(arg(argc,argv,L"--target")!=token)return fail();auto source=arg(argc,argv,L"--source");
  if(source.size()!=13||source.substr(0,5)!=L"klid:"||source.find_first_not_of(L"0123456789ABCDEF",5)!=std::wstring::npos)return fail();
  HKL selected=nullptr;
  for(auto h:layouts)if(L"klid:"+klid(h)==source){selected=h;break;}if(!selected||target(app)!=hwnd)return fail();
  DWORD_PTR result=0;
  // A timed-out message may already be accepted by the OS. Do not claim rollback.
  if(!SendMessageTimeoutW(hwnd,WM_INPUTLANGCHANGEREQUEST,0,reinterpret_cast<LPARAM>(selected),SMTO_ABORTIFHUNG|SMTO_BLOCK|SMTO_ERRORONEXIT,700,&result))return fail();
 }else if(op!=L"get"&&op!=L"probe")return fail();
 if(target(app)!=hwnd)return fail();auto current=klid(GetKeyboardLayout(thread));if(current.empty()||target(app)!=hwnd)return fail();
 std::wcout<<L"{\"version\":1,\"sourceId\":\"klid:"<<current<<L"\",\"status\":\"observed\"}\n";return 0;
}
