#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>
#include <iostream>
static NSString* argument(int argc,const char**argv,NSString* key){for(int i=2;i+1<argc;i++)if([@(argv[i]) isEqualToString:key])return @(argv[i+1]);return @"";}
static int emit(NSDictionary* object,int code=0){NSData* data=[NSJSONSerialization dataWithJSONObject:object options:0 error:nil];if(!data)return 1;std::cout.write((const char*)data.bytes,data.length);std::cout<<"\n";return code;}
static int fail(){return emit(@{@"version":@1,@"status":@"failed"},1);}
static NSString* current(){TISInputSourceRef source=TISCopyCurrentKeyboardInputSource();if(!source)return nil;NSString* id=[(__bridge NSString*)TISGetInputSourceProperty(source,kTISPropertyInputSourceID) copy];CFRelease(source);return id;}
static NSRunningApplication* foreground(NSString* path){
 NSRange r=[path rangeOfString:@".app/"];if(r.location==NSNotFound)return nil;
 NSString* bundle=[path substringToIndex:r.location+4];NSRunningApplication* app=NSWorkspace.sharedWorkspace.frontmostApplication;
 return [[app.bundleURL.path stringByResolvingSymlinksInPath] isEqualToString:[bundle stringByResolvingSymlinksInPath]]?app:nil;
}
int main(int argc,const char**argv){@autoreleasepool{
 if(argc<2)return fail();NSString* op=@(argv[1]);NSString* expected=argument(argc,argv,@"--app");
 if([op isEqualToString:@"target"]){NSRunningApplication* app=foreground(expected);if(!app)return fail();return emit(@{@"version":@1,@"target":[NSString stringWithFormat:@"%d",app.processIdentifier]});}
 if([op isEqualToString:@"list"]||[op isEqualToString:@"set"]){
  CFArrayRef list=TISCreateInputSourceList(nullptr,false);if(!list)return fail();NSMutableArray* ids=[NSMutableArray array];bool selected=false;
  for(CFIndex i=0;i<CFArrayGetCount(list);i++){
   TISInputSourceRef item=(TISInputSourceRef)CFArrayGetValueAtIndex(list,i);
   if(TISGetInputSourceProperty(item,kTISPropertyInputSourceIsEnabled)!=kCFBooleanTrue||TISGetInputSourceProperty(item,kTISPropertyInputSourceIsSelectCapable)!=kCFBooleanTrue)continue;
   NSString* id=(__bridge NSString*)TISGetInputSourceProperty(item,kTISPropertyInputSourceID);if(!id)continue;[ids addObject:id];
   if([op isEqualToString:@"set"]&&[id isEqualToString:argument(argc,argv,@"--source")]){
    NSRunningApplication* app=foreground(expected);
    if(!app||![[NSString stringWithFormat:@"%d",app.processIdentifier] isEqualToString:argument(argc,argv,@"--target")]){CFRelease(list);return fail();}
    selected=TISSelectInputSource(item)==noErr;break;
   }
  }
  CFRelease(list);if([op isEqualToString:@"list"])return emit(@{@"version":@1,@"sources":ids});if(!selected)return fail();
  CFRunLoopRunInMode(kCFRunLoopDefaultMode,0.03,false);
 }else if(![op isEqualToString:@"get"]&&![op isEqualToString:@"probe"])return fail();
 NSString* id=current();if(!id)return fail();return emit(@{@"version":@1,@"sourceId":id,@"status":@"observed"});
}}
