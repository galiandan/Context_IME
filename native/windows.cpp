#define UNICODE
#define _UNICODE
#include <windows.h>
#include <string>
#include <vector>
#include <iostream>
#include <algorithm>
#include <cstdint>
#include <cwchar>
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
  wchar_t id[32]={};DWORD bytes=sizeof(id),type=0;LONG result=RegQueryValueExW(item,L"Layout Id",nullptr,&type,reinterpret_cast<BYTE*>(id),&bytes);RegCloseKey(item);
  if(result==ERROR_SUCCESS&&type==REG_SZ&&wcstoul(id,nullptr,16)==(device&0x0FFF)){if(!match.empty()){match.clear();break;}match=name;}
 }
 RegCloseKey(base);return match;
}
static HWND target(const std::wstring&expected){
 HWND hwnd=GetForegroundWindow();DWORD pid=0;GetWindowThreadProcessId(hwnd,&pid);
 HANDLE p=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid);if(!p)return nullptr;
 wchar_t path[32768];DWORD size=32768;BOOL ok=QueryFullProcessImageNameW(p,0,path,&size);CloseHandle(p);
 if(!ok||_wcsicmp(expected.c_str(),path)!=0)return nullptr;return hwnd;
}
int wmain(int argc,wchar_t**argv){
 if(argc<2)return fail();std::wstring op=argv[1];auto app=arg(argc,argv,L"--app");
 int count=GetKeyboardLayoutList(0,nullptr);if(count<=0||count>512)return fail();
 std::vector<HKL> layouts(count);GetKeyboardLayoutList(count,layouts.data());
 if(op==L"list"){
  std::cout<<"{\"version\":1,\"sources\":[";bool first=true;
  for(auto h:layouts){auto id=klid(h);if(id.empty())continue;if(!first)std::cout<<",";first=false;std::wcout<<L"\"klid:"<<id<<L"\"";}
  std::cout<<"]}\n";return 0;
 }
 HWND hwnd=target(app);if(!hwnd)return fail();DWORD pid=0;DWORD thread=GetWindowThreadProcessId(hwnd,&pid);
 std::wstring token=std::to_wstring(reinterpret_cast<uintptr_t>(hwnd))+L":"+std::to_wstring(pid)+L":"+std::to_wstring(thread);
 if(op==L"target"){std::wcout<<L"{\"version\":1,\"target\":\""<<token<<L"\"}\n";return 0;}
 if(op==L"set"){
  if(arg(argc,argv,L"--target")!=token)return fail();auto source=arg(argc,argv,L"--source");HKL selected=nullptr;
  for(auto h:layouts)if(L"klid:"+klid(h)==source){selected=h;break;}if(!selected||target(app)!=hwnd)return fail();
  DWORD_PTR result=0;
  // A timed-out message may already be accepted by the OS. Do not claim rollback.
  if(!SendMessageTimeoutW(hwnd,WM_INPUTLANGCHANGEREQUEST,0,reinterpret_cast<LPARAM>(selected),SMTO_ABORTIFHUNG|SMTO_BLOCK,700,&result))return fail();
 }else if(op!=L"get"&&op!=L"probe")return fail();
 if(target(app)!=hwnd)return fail();auto current=klid(GetKeyboardLayout(thread));if(current.empty())return fail();
 std::wcout<<L"{\"version\":1,\"sourceId\":\"klid:"<<current<<L"\",\"status\":\"observed\"}\n";return 0;
}
