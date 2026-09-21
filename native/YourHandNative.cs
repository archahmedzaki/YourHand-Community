using System;
using System.Collections;
using System.Collections.Generic;
using System.Security.Principal;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

class YourHandNative {
  static JavaScriptSerializer js = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
  // Guarded frames retain only a digest and window identity, never screen pixels.
  sealed class FrameRef { public string Id, Digest; public long Hwnd; public int Pid, Left, Top, Width, Height, ImageWidth, ImageHeight, Quality, MaxWidth, MaxHeight; public string Format; public DateTime Issued; }
  static readonly Dictionary<string,FrameRef> frames = new Dictionary<string,FrameRef>();
  static readonly TimeSpan frameLifetime = TimeSpan.FromSeconds(30);
  static string FrameDigest(string b64) {
    using(var sha=SHA256.Create()) return Convert.ToBase64String(sha.ComputeHash(Convert.FromBase64String(b64)));
  }
  static void PruneFrames() {
    var now=DateTime.UtcNow; var expired=new List<string>();
    foreach(var kv in frames)if(now-kv.Value.Issued>frameLifetime)expired.Add(kv.Key);
    foreach(var k in expired)frames.Remove(k);
    while(frames.Count>=32){string oldest=null;DateTime t=DateTime.MaxValue;
      foreach(var kv in frames)if(kv.Value.Issued<t){t=kv.Value.Issued;oldest=kv.Key;}
      if(oldest==null)break;frames.Remove(oldest);
    }
  }

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll", SetLastError=true)] static extern bool SetThreadDesktop(IntPtr hDesktop);
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint threadId);
  [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr hObj,int nIndex,StringBuilder info,uint len,out uint needed);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  [DllImport("user32.dll")] static extern IntPtr SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);

  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public UIntPtr dwExtraInfo; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  const uint MOUSEEVENTF_LEFTDOWN=0x0002, MOUSEEVENTF_LEFTUP=0x0004, MOUSEEVENTF_RIGHTDOWN=0x0008, MOUSEEVENTF_RIGHTUP=0x0010, MOUSEEVENTF_MIDDLEDOWN=0x0020, MOUSEEVENTF_MIDDLEUP=0x0040, MOUSEEVENTF_WHEEL=0x0800;
  const uint KEYEVENTF_KEYUP=0x0002, KEYEVENTF_UNICODE=0x0004;
  const uint WM_CLOSE=0x0010;
  const uint DESKTOP_ACCESS=0x01C1;
  const int UOI_NAME=2;
  static IntPtr inputDesktop=IntPtr.Zero;

  static Dictionary<string,object> D(object x) { return x as Dictionary<string,object> ?? new Dictionary<string,object>(); }
  static string S(Dictionary<string,object> d,string k,string def="") { object v; return d.TryGetValue(k,out v)&&v!=null ? Convert.ToString(v) : def; }
  static int I(Dictionary<string,object> d,string k,int def=0) { object v; try{return d.TryGetValue(k,out v)&&v!=null?Convert.ToInt32(v):def;}catch{return def;} }
  static long L(Dictionary<string,object> d,string k,long def=0) { object v; try{return d.TryGetValue(k,out v)&&v!=null?Convert.ToInt64(v):def;}catch{return def;} }
  static bool B(Dictionary<string,object> d,string k,bool def=false) { object v; try{return d.TryGetValue(k,out v)&&v!=null?Convert.ToBoolean(v):def;}catch{return def;} }

  static string UserObjectName(IntPtr h) {
    if(h==IntPtr.Zero)return "";
    uint needed=0; GetUserObjectInformation(h,UOI_NAME,null,0,out needed);
    if(needed==0)return "";
    var sb=new StringBuilder((int)(needed/2)+2);
    return GetUserObjectInformation(h,UOI_NAME,sb,(uint)(sb.Capacity*2),out needed)?sb.ToString():"";
  }
  static Dictionary<string,object> AttachInputDesktop() {
    uint tid=GetCurrentThreadId();
    string before=UserObjectName(GetThreadDesktop(tid));
    string station=UserObjectName(GetProcessWindowStation());
    IntPtr h=OpenInputDesktop(0,false,DESKTOP_ACCESS);
    int err=Marshal.GetLastWin32Error(); bool ok=false; string input="";
    // Never attach the helper to a protected consent/logon desktop.
    if(h!=IntPtr.Zero){input=UserObjectName(h);
      if(String.Equals(input,"Default",StringComparison.OrdinalIgnoreCase)){
        ok=SetThreadDesktop(h);if(ok)inputDesktop=h;
      }
    }
    string after=UserObjectName(GetThreadDesktop(tid));
    return new Dictionary<string,object>{{"station",station},{"before",before},{"input",input},{"after",after},{"attached",ok},{"openError",err}};
  }

  static bool IsSessionLocked() {
    int sid=Process.GetCurrentProcess().SessionId;
    try { foreach(var p in Process.GetProcessesByName("LogonUI")) { try { if(p.SessionId==sid) return true; } catch {} } } catch {}
    return false;
  }
  // Read-only detection only: never access, display, type in, or switch to an
  // administrator consent screen. Unknown/nondefault desktops are not GUI-ready.
  static bool ApprovalPromptDetected() {
    string desktop=UserObjectName(GetThreadDesktop(GetCurrentThreadId()));
    if(!String.IsNullOrEmpty(desktop) &&
       !String.Equals(desktop,"Default",StringComparison.OrdinalIgnoreCase)) return true;
    int session=Process.GetCurrentProcess().SessionId;
    try{
      foreach(var p in Process.GetProcessesByName("consent")){
        try{if(p.SessionId==session)return true;}
        catch{}finally{p.Dispose();}
      }
    }catch{}
    return false;
  }
  static object SessionState() {
    IntPtr fg=GetForegroundWindow();
    bool elevated=false;
    try {
      using(var identity=WindowsIdentity.GetCurrent()){
        elevated=new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
      }
    }catch{}
    bool locked=IsSessionLocked(),approvalPending=ApprovalPromptDetected();
    return new Dictionary<string,object>{{"sessionId",Process.GetCurrentProcess().SessionId},
      {"approvalPending",approvalPending},
      {"locked",locked},{"desktop",UserObjectName(GetThreadDesktop(GetCurrentThreadId()))},
      {"station",UserObjectName(GetProcessWindowStation())},{"foregroundHwnd",fg.ToInt64()},
      {"interactive",!locked && !approvalPending && fg!=IntPtr.Zero},{"elevated",elevated},
      {"secureDesktopInputSupported",false},{"headlessBackgroundExecutionSupported",true}};
  }
  static void RequireInteractive() {
    if(ApprovalPromptDetected()) throw new Exception("USER_APPROVAL_REQUIRED: Windows needs local administrator approval. No desktop input sent. Ask the device user to approve locally, then take a new observation.");
    if(IsSessionLocked()||GetForegroundWindow()==IntPtr.Zero)
      throw new Exception("Interactive desktop unavailable or locked; do not inject input into a headless session");
  }

  static Dictionary<string,object> Rect(RECT r) {
    return new Dictionary<string,object>{{"x",r.Left},{"y",r.Top},{"width",r.Right-r.Left},{"height",r.Bottom-r.Top},{"right",r.Right},{"bottom",r.Bottom}};
  }
  static string Title(IntPtr h) { int n=GetWindowTextLength(h); var sb=new StringBuilder(Math.Max(512,n+2)); GetWindowText(h,sb,sb.Capacity); return sb.ToString(); }
  static string WindowProcessName(IntPtr h) { try{uint p;GetWindowThreadProcessId(h,out p);return Process.GetProcessById((int)p).ProcessName??"";}catch{return "";} }

  static object ListWindows(Dictionary<string,object> a) {
    var list=new List<object>(); int onlyPid=I(a,"pid",0); bool visibleOnly=B(a,"visibleOnly",true);
    EnumWindows((h,l)=>{
      uint pid; GetWindowThreadProcessId(h,out pid);
      if(onlyPid>0 && pid!=onlyPid) return true;
      bool vis=IsWindowVisible(h); if(visibleOnly&&!vis) return true;
      string t=Title(h); if(visibleOnly&&String.IsNullOrWhiteSpace(t)) return true;
      RECT r; GetWindowRect(h,out r);
      string pn=""; try{pn=Process.GetProcessById((int)pid).ProcessName;}catch{}
      list.Add(new Dictionary<string,object>{{"hwnd",h.ToInt64()},{"pid",(int)pid},{"process",pn},{"title",t},{"visible",vis},{"bounds",Rect(r)},{"foreground",h==GetForegroundWindow()}});
      return true;
    },IntPtr.Zero);
    return list;
  }

  static IntPtr ResolveWindow(Dictionary<string,object> a) {
    long hv=L(a,"hwnd",0);
    if(hv!=0){
      var requested=new IntPtr(hv);
      if(B(a,"autoRetarget",false)){
        var fg=GetForegroundWindow();
        if(fg!=IntPtr.Zero && fg!=requested && IsWindowVisible(fg)){
          string rp=WindowProcessName(requested), fp=WindowProcessName(fg);
          if(rp!="" && String.Equals(rp,fp,StringComparison.OrdinalIgnoreCase)) return fg;
        }
      }
      return requested;
    }
    int pid=I(a,"pid",0); string contains=S(a,"titleContains",""); string exact=S(a,"title","");
    bool hasSelector=pid>0||!String.IsNullOrEmpty(exact)||!String.IsNullOrEmpty(contains);
    if(!hasSelector){
      var fg=GetForegroundWindow();
      if(fg!=IntPtr.Zero && IsWindowVisible(fg)) return fg;
    }
    IntPtr found=IntPtr.Zero; long bestArea=-1;
    EnumWindows((h,l)=>{
      uint p; GetWindowThreadProcessId(h,out p);
      if(pid>0&&p!=pid) return true;
      string t=Title(h);
      if(!String.IsNullOrEmpty(exact)&&!String.Equals(t,exact,StringComparison.OrdinalIgnoreCase)) return true;
      if(!String.IsNullOrEmpty(contains)&&t.IndexOf(contains,StringComparison.OrdinalIgnoreCase)<0) return true;
      if(!hasSelector||!IsWindowVisible(h)) return true;
      RECT r; GetWindowRect(h,out r);
      long w=Math.Max(0,r.Right-r.Left), hh=Math.Max(0,r.Bottom-r.Top), area=w*hh;
      if(area>bestArea){bestArea=area;found=h;}
      return true;
    },IntPtr.Zero);
    return found;
  }

  static object Foreground() {
    var h=GetForegroundWindow(); uint p; GetWindowThreadProcessId(h,out p); RECT r; GetWindowRect(h,out r);
    return new Dictionary<string,object>{{"hwnd",h.ToInt64()},{"pid",(int)p},{"title",Title(h)},{"bounds",Rect(r)}};
  }

  static object FocusWindow(Dictionary<string,object> a) {
    RequireInteractive();
    var h=ResolveWindow(a); if(h==IntPtr.Zero) throw new Exception("Window not found");
    if(IsIconic(h)) ShowWindow(h,9);
    IntPtr fg=GetForegroundWindow(); uint dummy;
    uint curT=GetCurrentThreadId();
    uint fgT=fg==IntPtr.Zero?0:GetWindowThreadProcessId(fg,out dummy);
    uint targetT=GetWindowThreadProcessId(h,out dummy);
    bool af=false, at=false;
    try {
      if(fgT!=0 && fgT!=curT) af=AttachThreadInput(curT,fgT,true);
      if(targetT!=0 && targetT!=curT) at=AttachThreadInput(curT,targetT,true);
      keybd_event(0x12,0,0,UIntPtr.Zero); keybd_event(0x12,0,KEYEVENTF_KEYUP,UIntPtr.Zero);
      SwitchToThisWindow(h,true);
      BringWindowToTop(h);
      SetActiveWindow(h);
      bool ok=SetForegroundWindow(h);
      SetFocus(h);
      Thread.Sleep(I(a,"settleMs",60));
      return new Dictionary<string,object>{{"hwnd",h.ToInt64()},{"focused",GetForegroundWindow()==h||ok},{"title",Title(h)}};
    } finally {
      if(at) AttachThreadInput(curT,targetT,false);
      if(af) AttachThreadInput(curT,fgT,false);
    }
  }

  static object CloseWindow(Dictionary<string,object> a) {
    RequireInteractive();
    var h=ResolveWindow(a); if(h==IntPtr.Zero) throw new Exception("Window not found");
    return new Dictionary<string,object>{{"hwnd",h.ToInt64()},{"posted",PostMessage(h,WM_CLOSE,IntPtr.Zero,IntPtr.Zero)}};
  }

  static INPUT MouseInput(uint flags) {
    var input=new INPUT(); input.type=0; input.U.mi.dwFlags=flags; return input;
  }
  static INPUT KeyInput(ushort vk,ushort scan,uint flags) {
    var input=new INPUT(); input.type=1; input.U.ki.wVk=vk;input.U.ki.wScan=scan;
    input.U.ki.dwFlags=flags;return input;
  }
  // Do not replay partially injected events: the side effect may already have occurred.
  static int Inject(INPUT[] events) {
    if(events.Length==0)return 0;
    uint sent=SendInput((uint)events.Length,events,Marshal.SizeOf(typeof(INPUT)));
    if(sent!=(uint)events.Length)throw new Exception("INPUT_UNCERTAIN: SendInput accepted "+sent+" of "+events.Length+" events; do not retry without observation");
    return (int)sent;
  }
  static object Mouse(Dictionary<string,object> a) {
    RequireInteractive();
    int x=I(a,"x"),y=I(a,"y"); string kind=S(a,"kind","click").ToLowerInvariant();
    string button=S(a,"button","left").ToLowerInvariant();
    if(kind!="move"&&kind!="click"&&kind!="double")throw new Exception("Unsupported mouse kind");
    uint down=MOUSEEVENTF_LEFTDOWN,up=MOUSEEVENTF_LEFTUP;
    if(button=="right"){down=MOUSEEVENTF_RIGHTDOWN;up=MOUSEEVENTF_RIGHTUP;}
    else if(button=="middle"){down=MOUSEEVENTF_MIDDLEDOWN;up=MOUSEEVENTF_MIDDLEUP;}
    else if(button!="left")throw new Exception("Unsupported mouse button");
    int count=I(a,"count",kind=="double"?2:1);
    if(count<1||count>5)throw new Exception("Mouse count must be 1-5");
    bool moved=SetCursorPos(x,y); POINT actual;GetCursorPos(out actual);
    if(kind=="move")return new Dictionary<string,object>{{"x",x},{"y",y},{"moved",moved},
      {"actualX",actual.X},{"actualY",actual.Y}};
    if(!moved||actual.X!=x||actual.Y!=y)throw new Exception("INPUT_REJECTED: mouse cursor could not reach target");
    long expected=L(a,"expectedHwnd",0);
    if(expected!=0 && GetForegroundWindow().ToInt64()!=expected)
      throw new Exception("STALE_REFERENCE: target lost foreground before input");
    var events=new INPUT[count*2];
    for(int i=0;i<count;i++){events[i*2]=MouseInput(down);events[i*2+1]=MouseInput(up);}
    // SendInput injects a single click (or double-click sequence) as one ordered batch.
    int injected=Inject(events);
    GetCursorPos(out actual);
    return new Dictionary<string,object>{{"x",x},{"y",y},{"button",button},{"count",count},
      {"moved",moved},{"actualX",actual.X},{"actualY",actual.Y},
      {"inputEvents",injected},{"backend","sendinput-batched"}};
  }

  static object Scroll(Dictionary<string,object> a) {
    RequireInteractive();
    int x=I(a,"x",-1),y=I(a,"y",-1);
    if(x>=0&&y>=0){
      POINT actual;
      if(!SetCursorPos(x,y)||!GetCursorPos(out actual)||actual.X!=x||actual.Y!=y)
        throw new Exception("INPUT_REJECTED: mouse cursor could not reach scroll target");
    }
    int delta=I(a,"delta",-120);
    var wheel=MouseInput(MOUSEEVENTF_WHEEL);
    wheel.U.mi.mouseData=unchecked((uint)delta);
    int injected=Inject(new[]{wheel});
    return new Dictionary<string,object>{{"delta",delta},{"inputEvents",injected},{"backend","sendinput-batched"}};
  }

  static byte Vk(string key) {
    key=(key??"").ToUpperInvariant();
    var map=new Dictionary<string,byte>{{"CTRL",0x11},{"CONTROL",0x11},{"ALT",0x12},{"SHIFT",0x10},{"WIN",0x5B},{"ENTER",0x0D},{"TAB",0x09},{"ESC",0x1B},{"ESCAPE",0x1B},{"SPACE",0x20},{"BACKSPACE",0x08},{"DELETE",0x2E},{"UP",0x26},{"DOWN",0x28},{"LEFT",0x25},{"RIGHT",0x27},{"HOME",0x24},{"END",0x23},{"PGUP",0x21},{"PGDN",0x22},{"F1",0x70},{"F2",0x71},{"F3",0x72},{"F4",0x73},{"F5",0x74},{"F6",0x75},{"F7",0x76},{"F8",0x77},{"F9",0x78},{"F10",0x79},{"F11",0x7A},{"F12",0x7B}};
    byte v; if(map.TryGetValue(key,out v))return v;
    if(key.Length==1){char c=key[0]; if(c>='A'&&c<='Z')return (byte)c; if(c>='0'&&c<='9')return (byte)c;}
    throw new Exception("Unknown key: "+key);
  }

  static object Hotkey(Dictionary<string,object> a) {
    RequireInteractive();
    var keys=new List<byte>();
    object ko;if(a.TryGetValue("keys",out ko)&&ko is System.Collections.IEnumerable){
      foreach(var k in (System.Collections.IEnumerable)ko)keys.Add(Vk(Convert.ToString(k)));
    }else{
      foreach(var k in S(a,"combo","").Split(new[]{'+',' '},StringSplitOptions.RemoveEmptyEntries))keys.Add(Vk(k));
    }
    if(keys.Count==0||keys.Count>8)throw new Exception("Hotkey must contain 1-8 keys");
    int settle=I(a,"settleMs",0);if(settle<0||settle>5000)throw new Exception("settleMs out of range");
    var events=new INPUT[keys.Count*2];
    for(int i=0;i<keys.Count;i++)events[i]=KeyInput(keys[i],0,0);
    for(int i=0;i<keys.Count;i++)events[keys.Count+i]=KeyInput(keys[keys.Count-1-i],0,KEYEVENTF_KEYUP);
    int injected=Inject(events);
    // No unconditional 25ms delay; callers can request settleMs when their app needs it.
    if(settle>0)Thread.Sleep(settle);
    return new Dictionary<string,object>{{"keys",keys.Count},{"inputEvents",injected},{"backend","sendinput-batched"}};
  }

  static object TypeText(Dictionary<string,object> a) {
    RequireInteractive();
    string s=S(a,"text","");int delay=I(a,"delayMs",0);
    if(delay<0||delay>5000)throw new Exception("delayMs out of range");
    // Unicode UTF-16 events stay ordered inside each SendInput call. Chunk to cap memory.
    const int charsPerChunk=128;
    int calls=0,injected=0;
    if(delay==0){
      for(int start=0;start<s.Length;start+=charsPerChunk){
        int len=Math.Min(charsPerChunk,s.Length-start);
        var events=new INPUT[len*2];
        for(int i=0;i<len;i++){
          ushort ch=s[start+i];
          events[2*i]=KeyInput(0,ch,KEYEVENTF_UNICODE);
          events[2*i+1]=KeyInput(0,ch,KEYEVENTF_UNICODE|KEYEVENTF_KEYUP);
        }
        injected+=Inject(events);calls++;
      }
    }else{
      foreach(char ch in s){
        injected+=Inject(new[]{KeyInput(0,ch,KEYEVENTF_UNICODE),
          KeyInput(0,ch,KEYEVENTF_UNICODE|KEYEVENTF_KEYUP)});
        calls++;Thread.Sleep(delay);
      }
    }
    return new Dictionary<string,object>{{"chars",s.Length},{"inputEvents",injected},
      {"sendInputCalls",calls},{"backend","unicode-sendinput-batched"}};
  }

  static object ClipboardGet() {
    string t=""; if(Clipboard.ContainsText())t=Clipboard.GetText();
    return new Dictionary<string,object>{{"text",t},{"length",t.Length}};
  }
  static object ClipboardSet(Dictionary<string,object> a) {
    string t=S(a,"text",""); Clipboard.SetText(t??""); return new Dictionary<string,object>{{"length",t.Length}};
  }

  static ImageCodecInfo JpegCodec() {
    foreach(var c in ImageCodecInfo.GetImageEncoders()) if(c.MimeType=="image/jpeg") return c;
    return null;
  }

  static byte[] EncodeShot(Bitmap src,string format,int quality,int maxWidth,int maxHeight,out int outW,out int outH) {
    outW=src.Width; outH=src.Height;
    double scale=1.0;
    if(maxWidth>0 && outW>maxWidth) scale=Math.Min(scale,(double)maxWidth/outW);
    if(maxHeight>0 && outH>maxHeight) scale=Math.Min(scale,(double)maxHeight/outH);
    Bitmap target=src; bool disposeTarget=false;
    if(scale<0.999){
      outW=Math.Max(1,(int)Math.Round(src.Width*scale)); outH=Math.Max(1,(int)Math.Round(src.Height*scale));
      target=new Bitmap(outW,outH,PixelFormat.Format24bppRgb); disposeTarget=true;
      using(var g=Graphics.FromImage(target)){
        g.InterpolationMode=System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
        g.PixelOffsetMode=System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
        g.DrawImage(src,0,0,outW,outH);
      }
    }
    try{
      using(var ms=new MemoryStream()){
        if(format=="jpg"||format=="jpeg"){
          var codec=JpegCodec(); if(codec==null)throw new Exception("JPEG codec unavailable");
          long q=Math.Max(20,Math.Min(95,quality));
          using(var ep=new EncoderParameters(1)){
            ep.Param[0]=new EncoderParameter(System.Drawing.Imaging.Encoder.Quality,q);
            target.Save(ms,codec,ep);
          }
        } else target.Save(ms,ImageFormat.Png);
        return ms.ToArray();
      }
    } finally { if(disposeTarget)target.Dispose(); }
  }

  static object Screenshot(Dictionary<string,object> a) {
    // Do not capture password/consent prompts even if an input desktop changes.
    if(ApprovalPromptDetected()) throw new Exception("USER_APPROVAL_REQUIRED: Screen capture paused until Windows user approval completes.");
    string format=S(a,"format","png").ToLowerInvariant(); if(format=="jpg")format="jpeg"; if(format!="jpeg")format="png";
    bool memory=B(a,"memory",false);
    string ext=format=="jpeg"?".jpg":".png";
    string file=memory?"":S(a,"path",Path.Combine(Path.GetTempPath(),"yourhand-"+Guid.NewGuid().ToString("N")+ext));
    long hv=L(a,"hwnd",0); if(hv==0&&B(a,"window",false)){var h=ResolveWindow(a);hv=h.ToInt64();}
    int w,hgt,outW=0,outH=0; int quality=I(a,"quality",55), maxWidth=I(a,"maxWidth",0), maxHeight=I(a,"maxHeight",0);
    string captureMethod=S(a,"captureMethod","printwindow").ToLowerInvariant();
    byte[] bytes;
    if(hv!=0){
      var h=new IntPtr(hv); RECT r; if(!GetWindowRect(h,out r))throw new Exception("GetWindowRect failed"); w=Math.Max(1,r.Right-r.Left);hgt=Math.Max(1,r.Bottom-r.Top);
      using(var bmp=new Bitmap(w,hgt,PixelFormat.Format32bppArgb))using(var g=Graphics.FromImage(bmp)){
        if(captureMethod=="screen"){
          if(GetForegroundWindow()!=h)throw new Exception("Fast screen capture requires target foreground");
          g.CopyFromScreen(r.Left,r.Top,0,0,new Size(w,hgt),CopyPixelOperation.SourceCopy);
          if(GetForegroundWindow()!=h)throw new Exception("Foreground changed during capture");
        } else {
          IntPtr dc=g.GetHdc(); try{if(!PrintWindow(h,dc,2))throw new Exception("PrintWindow failed");}finally{g.ReleaseHdc(dc);}
        }
        bytes=EncodeShot(bmp,format,quality,maxWidth,maxHeight,out outW,out outH);
      }
    } else {
      var vs=SystemInformation.VirtualScreen; w=vs.Width;hgt=vs.Height;
      using(var bmp=new Bitmap(w,hgt,PixelFormat.Format32bppArgb))using(var g=Graphics.FromImage(bmp)){g.CopyFromScreen(vs.Left,vs.Top,0,0,new Size(w,hgt));bytes=EncodeShot(bmp,format,quality,maxWidth,maxHeight,out outW,out outH);}
    }
    var result=new Dictionary<string,object>{{"width",outW},{"height",outH},{"sourceWidth",w},{"sourceHeight",hgt},{"format",format},{"quality",quality},{"bytes",bytes.Length},{"memory",memory}};
    if(memory)result["dataBase64"]=Convert.ToBase64String(bytes);
    else {Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(file)));File.WriteAllBytes(file,bytes);result["path"]=file;}
    return result;
  }

  static AutomationElement UiRoot(Dictionary<string,object> a) {
    var wh=ResolveWindow(a); if(wh!=IntPtr.Zero)return AutomationElement.FromHandle(wh);
    int pid=I(a,"pid",0); if(pid>0){
      IntPtr h=IntPtr.Zero; try{h=Process.GetProcessById(pid).MainWindowHandle;}catch{}
      if(h!=IntPtr.Zero)return AutomationElement.FromHandle(h);
    }
    return AutomationElement.RootElement;
  }

  static Dictionary<string,object> UiItem(AutomationElement e) {
    var d=new Dictionary<string,object>();
    try{d["name"]=e.Current.Name;}catch{d["name"]="";}
    try{d["automationId"]=e.Current.AutomationId;}catch{d["automationId"]="";}
    try{d["className"]=e.Current.ClassName;}catch{d["className"]="";}
    try{d["controlType"]=e.Current.ControlType.ProgrammaticName.Replace("ControlType.","");}catch{d["controlType"]="";}
    try{d["pid"]=e.Current.ProcessId;}catch{d["pid"]=0;}
    try{d["enabled"]=e.Current.IsEnabled;}catch{d["enabled"]=false;}
    try{d["offscreen"]=e.Current.IsOffscreen;}catch{d["offscreen"]=true;}
    try{var r=e.Current.BoundingRectangle;d["bounds"]=new Dictionary<string,object>{{"x",(int)r.X},{"y",(int)r.Y},{"width",(int)r.Width},{"height",(int)r.Height}};}catch{}
    return d;
  }

  static bool Match(AutomationElement e,Dictionary<string,object> a) {
    string name=S(a,"name",""), contains=S(a,"nameContains",""), aid=S(a,"automationId",""), ct=S(a,"controlType",""), cls=S(a,"className","");
    try{
      if(name!=""&&!String.Equals(e.Current.Name,name,StringComparison.OrdinalIgnoreCase))return false;
      if(contains!=""&&(e.Current.Name??"").IndexOf(contains,StringComparison.OrdinalIgnoreCase)<0)return false;
      if(aid!=""&&!String.Equals(e.Current.AutomationId,aid,StringComparison.OrdinalIgnoreCase))return false;
      if(cls!=""&&!String.Equals(e.Current.ClassName,cls,StringComparison.OrdinalIgnoreCase))return false;
      if(ct!=""){
        string got=e.Current.ControlType.ProgrammaticName.Replace("ControlType.","");
        if(!String.Equals(got,ct,StringComparison.OrdinalIgnoreCase))return false;
      }
      return true;
    }catch{return false;}
  }

  static List<AutomationElement> FindUiElements(Dictionary<string,object> a,int limit) {
    var outp=new List<AutomationElement>();
    int pid=I(a,"pid",0);
    AutomationElement root;
    AutomationElementCollection els;
    bool pidGlobal = pid>0 && L(a,"hwnd",0)==0 && S(a,"title","")=="" && S(a,"titleContains","")=="";
    if(pidGlobal){
      root=AutomationElement.RootElement;
      var pc=new PropertyCondition(AutomationElement.ProcessIdProperty,pid);
      els=root.FindAll(TreeScope.Descendants,pc);
    } else {
      root=UiRoot(a);
      els=root.FindAll(TreeScope.Descendants,Condition.TrueCondition);
    }
    foreach(AutomationElement e in els){if(Match(e,a)){outp.Add(e);if(outp.Count>=limit)break;}}
    return outp;
  }

  static object UiTree(Dictionary<string,object> a) {
    RequireInteractive();
    int limit=Math.Min(Math.Max(I(a,"limit",500),1),3000); var list=new List<object>();
    int pid=I(a,"pid",0); AutomationElement root; AutomationElementCollection els;
    bool pidGlobal = pid>0 && L(a,"hwnd",0)==0 && S(a,"title","")=="" && S(a,"titleContains","")=="";
    if(pidGlobal){
      root=AutomationElement.RootElement;
      var pc=new PropertyCondition(AutomationElement.ProcessIdProperty,pid);
      els=root.FindAll(TreeScope.Descendants,pc);
    } else {
      root=UiRoot(a); els=root.FindAll(TreeScope.Descendants,Condition.TrueCondition);
    }
    foreach(AutomationElement e in els){list.Add(UiItem(e));if(list.Count>=limit)break;}
    return new Dictionary<string,object>{{"root",pidGlobal?new Dictionary<string,object>{{"pid",pid},{"scope","desktop-process"}}:UiItem(root)},{"items",list},{"count",list.Count},{"truncated",els.Count>list.Count}};
  }
  static object UiFind(Dictionary<string,object> a) {
    RequireInteractive();
    int limit=Math.Min(Math.Max(I(a,"limit",20),1),100); var found=FindUiElements(a,limit);var list=new List<object>();foreach(var e in found)list.Add(UiItem(e));
    return new Dictionary<string,object>{{"items",list},{"count",list.Count}};
  }
  static object UiInvoke(Dictionary<string,object> a) {
    RequireInteractive();
    var f=FindUiElements(a,1); if(f.Count==0)throw new Exception("UI element not found"); var e=f[0];
    object pat;
    if(e.TryGetCurrentPattern(InvokePattern.Pattern,out pat)){((InvokePattern)pat).Invoke();return new Dictionary<string,object>{{"method","invoke"},{"element",UiItem(e)}};}
    var r=e.Current.BoundingRectangle; if(r.Width<=0||r.Height<=0)throw new Exception("Element has no clickable bounds");
    int x=(int)(r.X+r.Width/2),y=(int)(r.Y+r.Height/2); SetCursorPos(x,y); mouse_event(MOUSEEVENTF_LEFTDOWN,0,0,0,UIntPtr.Zero);mouse_event(MOUSEEVENTF_LEFTUP,0,0,0,UIntPtr.Zero);
    return new Dictionary<string,object>{{"method","click"},{"x",x},{"y",y},{"element",UiItem(e)}};
  }
  static object UiSetValue(Dictionary<string,object> a) {
    RequireInteractive();
    var f=FindUiElements(a,1); if(f.Count==0)throw new Exception("UI element not found");var e=f[0];string val=S(a,"value","");
    object pat;if(e.TryGetCurrentPattern(ValuePattern.Pattern,out pat)){((ValuePattern)pat).SetValue(val);return new Dictionary<string,object>{{"method","valuePattern"},{"element",UiItem(e)}};}
    e.SetFocus(); Hotkey(new Dictionary<string,object>{{"combo","CTRL+A"}}); TypeText(new Dictionary<string,object>{{"text",val}});
    return new Dictionary<string,object>{{"method","focusAndType"},{"element",UiItem(e)}};
  }


  static Dictionary<string,object> SemanticArgs(Dictionary<string,object> scope, Dictionary<string,object> selector) {
    var a=new Dictionary<string,object>();
    foreach(var k in new[]{"hwnd","pid","title","titleContains"}) if(scope.ContainsKey(k)) a[k]=scope[k];
    foreach(var k in new[]{"name","automationId","controlType","className"}) if(selector.ContainsKey(k)) a[k]=selector[k];
    return a;
  }
  static Condition SemanticCondition(Dictionary<string,object> selector) {
    var conditions=new List<Condition>();
    string v;
    v=S(selector,"automationId",""); if(v!="")conditions.Add(new PropertyCondition(AutomationElement.AutomationIdProperty,v));
    v=S(selector,"name",""); if(v!="")conditions.Add(new PropertyCondition(AutomationElement.NameProperty,v));
    v=S(selector,"className",""); if(v!="")conditions.Add(new PropertyCondition(AutomationElement.ClassNameProperty,v));
    v=S(selector,"controlType","");
    if(v!=""){
      var field=typeof(ControlType).GetField(v);
      if(field==null)throw new Exception("Unknown control type: "+v);
      conditions.Add(new PropertyCondition(AutomationElement.ControlTypeProperty,field.GetValue(null)));
    }
    if(conditions.Count==0)throw new Exception("selector needs observed property");
    return conditions.Count==1?conditions[0]:new AndCondition(conditions.ToArray());
  }
  static AutomationElement SemanticFind(Dictionary<string,object> scope, Dictionary<string,object> selector) {
    if(selector==null)throw new Exception("selector required");
    var root=UiRoot(scope);
    var found=root.FindAll(TreeScope.Descendants,SemanticCondition(selector));
    if(found.Count!=1)throw new Exception("Selector matched "+found.Count+" controls; stopped");
    var e=found[0];
    if(e.Current.IsOffscreen||!e.Current.IsEnabled||e.Current.IsPassword)throw new Exception("Control unavailable or protected");
    return e;
  }
  static string SemanticValue(AutomationElement e,string property) {
    if(property=="name")return e.Current.Name??"";
    if(property=="value"){
      object p;if(!e.TryGetCurrentPattern(ValuePattern.Pattern,out p))throw new Exception("Control has no ValuePattern");
      return ((ValuePattern)p).Current.Value??"";
    }
    throw new Exception("Assertions support name or value");
  }
  static void SemanticAssert(Dictionary<string,object> scope, Dictionary<string,object> assertion) {
    SemanticGuard(scope);
    if(assertion==null||!assertion.ContainsKey("selector"))throw new Exception("assertion selector required");
    string property=S(assertion,"property",""), equals=S(assertion,"equals","");
    var e=SemanticFind(scope,D(assertion["selector"]));
    if(SemanticValue(e,property)!=equals)throw new Exception("Postcondition mismatch; stopped without replay");
  }
  static void SemanticGuard(Dictionary<string,object> scope) {
    RequireInteractive();
    var resolved=ResolveWindow(scope);
    if(resolved!=IntPtr.Zero && B(scope,"autoRetarget",false)) scope["hwnd"]=resolved.ToInt64();
    long hv=L(scope,"hwnd",0);
    if(B(scope,"requireForeground",true) && hv!=0 && GetForegroundWindow()!=new IntPtr(hv))throw new Exception("Target lost foreground; stopped");
  }
  static object SemanticSnapshot(Dictionary<string,object> scope) {
    SemanticGuard(scope);
    var root=UiRoot(scope); var cache=new CacheRequest();
    cache.TreeScope=TreeScope.Element;
    cache.Add(AutomationElement.AutomationIdProperty);cache.Add(AutomationElement.NameProperty);
    cache.Add(AutomationElement.ControlTypeProperty);cache.Add(AutomationElement.IsEnabledProperty);
    cache.Add(AutomationElement.IsOffscreenProperty);cache.Add(AutomationElement.IsPasswordProperty);
    var rows=new List<object>();
    using(cache.Activate()){
      var els=root.FindAll(TreeScope.Descendants,Condition.TrueCondition);
      if(els.Count>1500)throw new Exception("Tree too large; use scoped app tooling");
      foreach(AutomationElement e in els){
        try{
          var c=e.Cached;if(c.IsOffscreen||c.IsPassword)continue;
          rows.Add(new Dictionary<string,object>{{"automationId",c.AutomationId??""},{"name",c.Name??""},{"controlType",c.ControlType.ProgrammaticName.Replace("ControlType.","")},{"enabled",c.IsEnabled}});
        }catch{}
      }
    }
    return new Dictionary<string,object>{{"controls",rows},{"count",rows.Count},{"backend","windows-uia"}};
  }
  static object SemanticBatch(Dictionary<string,object> a) {
    SemanticGuard(a);
    object raw;if(!a.TryGetValue("steps",out raw)||!(raw is System.Collections.IEnumerable))throw new Exception("steps array required");
    var steps=new List<Dictionary<string,object>>();
    foreach(object o in (System.Collections.IEnumerable)raw)steps.Add(D(o));
    if(steps.Count<1||steps.Count>20)throw new Exception("Expected 1 to 20 bounded steps");
    foreach(var s in steps){
      string op=S(s,"op","");
      if(op!="assert"&&op!="set"&&op!="invoke")throw new Exception("Unsupported semantic operation");
      if(op=="assert"){ if(!s.ContainsKey("selector")||!s.ContainsKey("property")||!s.ContainsKey("equals"))throw new Exception("Invalid assert schema"); }
      else {
        if(!s.ContainsKey("selector")||!s.ContainsKey("expect"))throw new Exception("Mutation requires selector and expect");
        if(op=="set"&&!s.ContainsKey("value"))throw new Exception("Set requires value");
      }
    }
    // Optional guarded route: require a fresh observation before any UIA side effect.
    if(S(a,"observationId","")!=""){
      var authorized=ConsumeFrame(a,false);
      a["hwnd"]=authorized.Hwnd;
    }
    var events=new List<object>(); int completed=0; bool dispatched=false;
    foreach(var s in steps){
      SemanticGuard(a); var sw=Stopwatch.StartNew(); string op=S(s,"op","");
      try{
        if(op=="assert") SemanticAssert(a,s);
        else {
          var e=SemanticFind(a,D(s["selector"])); dispatched=true;
          if(op=="invoke"){
            object p;if(!e.TryGetCurrentPattern(InvokePattern.Pattern,out p))throw new Exception("InvokePattern unavailable");
            ((InvokePattern)p).Invoke();
          } else {
            object p;if(!e.TryGetCurrentPattern(ValuePattern.Pattern,out p))throw new Exception("ValuePattern unavailable");
            var vp=(ValuePattern)p;if(vp.Current.IsReadOnly)throw new Exception("Read-only control");
            vp.SetValue(Convert.ToString(s["value"]));
          }
          SemanticAssert(a,D(s["expect"])); dispatched=false;
        }
        completed++; events.Add(new Dictionary<string,object>{{"op",op},{"ok",true},{"elapsedMs",sw.ElapsedMilliseconds}});
      } catch(Exception ex) {
        events.Add(new Dictionary<string,object>{{"op",op},{"ok",false},{"elapsedMs",sw.ElapsedMilliseconds},{"error",ex.Message}});
        return new Dictionary<string,object>{{"ok",false},{"backend","windows-uia"},{"outcome",dispatched?"unknown-after-input":"stopped"},{"completed",completed},{"events",events},{"error",ex.Message}};
      }
    }
    return new Dictionary<string,object>{{"ok",true},{"backend","windows-uia"},{"outcome","postconditions-verified"},{"completed",completed},{"events",events}};
  }

  static Dictionary<string,object> WindowInfo(IntPtr h) {
    uint p=0; GetWindowThreadProcessId(h,out p); RECT r; GetWindowRect(h,out r);
    return new Dictionary<string,object>{{"hwnd",h.ToInt64()},{"pid",(int)p},{"process",WindowProcessName(h)},{"title",Title(h)},{"bounds",Rect(r)},{"foreground",h==GetForegroundWindow()}};
  }

  static object Observe(Dictionary<string,object> a) {
    RequireInteractive();
    var scope=new Dictionary<string,object>(a);
    scope["autoRetarget"]=true;
    var h=ResolveWindow(scope); if(h==IntPtr.Zero)throw new Exception("No interactive foreground window");
    scope["hwnd"]=h.ToInt64();
    scope["requireForeground"]=true;
    var shotArgs=new Dictionary<string,object>(scope);
    shotArgs["window"]=true; shotArgs["memory"]=true; shotArgs["captureMethod"]="screen";
    if(!shotArgs.ContainsKey("format"))shotArgs["format"]="jpeg";
    if(!shotArgs.ContainsKey("quality"))shotArgs["quality"]=45;
    if(!shotArgs.ContainsKey("maxWidth"))shotArgs["maxWidth"]=960;
    if(!shotArgs.ContainsKey("maxHeight"))shotArgs["maxHeight"]=700;
    var shot=D(Screenshot(shotArgs));
    // The reference is bound to the exact foreground window and preview pixels.
    uint pid;GetWindowThreadProcessId(h,out pid);RECT bounds;GetWindowRect(h,out bounds);
    PruneFrames();
    var frame=new FrameRef { Id=Guid.NewGuid().ToString("N"), Hwnd=h.ToInt64(), Pid=(int)pid,
      Left=bounds.Left, Top=bounds.Top, Width=bounds.Right-bounds.Left, Height=bounds.Bottom-bounds.Top,
      ImageWidth=I(shot,"width"), ImageHeight=I(shot,"height"), Quality=I(shotArgs,"quality",45),
      MaxWidth=I(shotArgs,"maxWidth",960), MaxHeight=I(shotArgs,"maxHeight",700), Format=S(shotArgs,"format","jpeg"),
      Digest=FrameDigest(S(shot,"dataBase64")), Issued=DateTime.UtcNow };
    frames[frame.Id]=frame;
    object snap=null;
    if(B(a,"semantic",false)) snap=SemanticSnapshot(scope);
    return new Dictionary<string,object>{{"observationId",frame.Id},{"frameId",frame.Id},
      {"validForMs",(int)frameLifetime.TotalMilliseconds},{"window",WindowInfo(h)},
      {"snapshot",snap},{"screenshot",shot}};
  }

  // Atomic, one-shot reference validation shared by preview and semantic routes.
  // Only metadata and the frame hash are kept in memory; captured pixels are discarded.
  static FrameRef ConsumeFrame(Dictionary<string,object> a,bool checkPreviewDimensions) {
    string id=S(a,"observationId","");
    if(id=="")throw new Exception("STALE_REFERENCE: observationId required");
    PruneFrames();
    FrameRef frame;
    if(!frames.TryGetValue(id,out frame))throw new Exception("STALE_REFERENCE: unknown, consumed or expired observation");
    if(L(a,"hwnd",0)!=0 && L(a,"hwnd",0)!=frame.Hwnd)
      throw new Exception("STALE_REFERENCE: selected window differs from observation");
    var h=new IntPtr(frame.Hwnd);
    if(GetForegroundWindow()!=h || !IsWindowVisible(h))
      throw new Exception("STALE_REFERENCE: foreground window changed");
    RECT r;
    if(!GetWindowRect(h,out r))throw new Exception("STALE_REFERENCE: target window is gone");
    uint pid;GetWindowThreadProcessId(h,out pid);
    if((int)pid!=frame.Pid || r.Left!=frame.Left || r.Top!=frame.Top ||
      r.Right-r.Left!=frame.Width || r.Bottom-r.Top!=frame.Height)
      throw new Exception("STALE_REFERENCE: window identity or bounds changed");
    if(checkPreviewDimensions && (I(a,"imageWidth",0)!=frame.ImageWidth || I(a,"imageHeight",0)!=frame.ImageHeight))
      throw new Exception("STALE_REFERENCE: preview dimensions changed");
    var capture=new Dictionary<string,object>{{"hwnd",frame.Hwnd},{"window",true},{"memory",true},
      {"captureMethod","screen"},{"format",frame.Format},{"quality",frame.Quality},
      {"maxWidth",frame.MaxWidth},{"maxHeight",frame.MaxHeight}};
    var current=D(Screenshot(capture));
    if(!String.Equals(frame.Digest,FrameDigest(S(current,"dataBase64")),StringComparison.Ordinal))
      throw new Exception("STALE_REFERENCE: screen pixels changed; observe again before acting");
    if(GetForegroundWindow()!=h)throw new Exception("STALE_REFERENCE: foreground changed during verification");
    frames.Remove(id); // Consume before dispatch, including uncertain outcomes.
    return frame;
  }

  static object ClickPreview(Dictionary<string,object> a) {
    RequireInteractive();
    var scope=new Dictionary<string,object>(a); scope["autoRetarget"]=true;
    var h=ResolveWindow(scope); if(h==IntPtr.Zero)throw new Exception("No target window");
    RECT r;if(!GetWindowRect(h,out r))throw new Exception("GetWindowRect failed");
    int iw=I(a,"imageWidth",0), ih=I(a,"imageHeight",0), ix=I(a,"x",-1), iy=I(a,"y",-1);
    string frameId=S(a,"observationId","");
    FrameRef frame=frameId!=""?ConsumeFrame(a,true):null;
    if(iw<=0||ih<=0||ix<0||iy<0||ix>=iw||iy>=ih)throw new Exception("Valid preview x/y/imageWidth/imageHeight required");
    int ww=Math.Max(1,r.Right-r.Left), wh=Math.Max(1,r.Bottom-r.Top);
    int sx=r.Left+(int)Math.Round(ix*(ww/(double)iw));
    int sy=r.Top+(int)Math.Round(iy*(wh/(double)ih));
    if(frame!=null && GetForegroundWindow()!=h)
      throw new Exception("STALE_REFERENCE: foreground switched before click");
    var m=new Dictionary<string,object>{{"x",sx},{"y",sy},{"kind",S(a,"kind","click")},{"button",S(a,"button","left")},{"count",I(a,"count",1)},{"expectedHwnd",h.ToInt64()}};
    var result=D(Mouse(m));
    if(frame!=null)result["observationId"]=frameId;
    result["previewX"]=ix;result["previewY"]=iy;result["imageWidth"]=iw;result["imageHeight"]=ih;
    result["targetHwnd"]=h.ToInt64();result["targetTitle"]=Title(h);
    return result;
  }

  static object WaitWindow(Dictionary<string,object> a) {
    int timeout=I(a,"timeoutMs",10000), poll=Math.Max(20,I(a,"pollMs",100)); var sw=Stopwatch.StartNew();
    while(sw.ElapsedMilliseconds<timeout){var h=ResolveWindow(a);if(h!=IntPtr.Zero)return new Dictionary<string,object>{{"found",true},{"hwnd",h.ToInt64()},{"title",Title(h)},{"elapsedMs",sw.ElapsedMilliseconds}};Thread.Sleep(poll);}
    return new Dictionary<string,object>{{"found",false},{"elapsedMs",sw.ElapsedMilliseconds}};
  }

  static object Launch(Dictionary<string,object> a) {
    string file=S(a,"file",""); if(file=="")throw new Exception("file required"); string args=S(a,"arguments","");
    var psi=new ProcessStartInfo(file,args){UseShellExecute=true}; var p=Process.Start(psi); return new Dictionary<string,object>{{"pid",p==null?0:p.Id}};
  }

  static object Execute(string action, Dictionary<string,object> a) {
    switch((action??"").ToLowerInvariant()){
      case "ping": return new Dictionary<string,object>{{"pong",true},{"utc",DateTime.UtcNow.ToString("o")}};
      case "desktop_context": return AttachInputDesktop();
      case "session_state": return SessionState();
      case "list_windows": return ListWindows(a);
      case "foreground": return Foreground();
      case "focus_window": return FocusWindow(a);
      case "close_window": return CloseWindow(a);
      case "mouse": return Mouse(a);
      case "scroll": return Scroll(a);
      case "hotkey": return Hotkey(a);
      case "type_text": return TypeText(a);
      case "clipboard_get": return ClipboardGet();
      case "clipboard_set": return ClipboardSet(a);
      case "screenshot": return Screenshot(a);
      case "ui_tree": return UiTree(a);
      case "ui_find": return UiFind(a);
      case "ui_invoke": return UiInvoke(a);
      case "ui_set_value": return UiSetValue(a);
      case "semantic_snapshot": return SemanticSnapshot(a);
      case "semantic_batch": return SemanticBatch(a);
      case "observe": return Observe(a);
      case "click_preview": return ClickPreview(a);
      case "wait_window": return WaitWindow(a);
      case "launch": return Launch(a);
      case "sleep": Thread.Sleep(I(a,"ms",100)); return new Dictionary<string,object>{{"sleptMs",I(a,"ms",100)}};
      default: throw new Exception("Unknown native action: "+action);
    }
  }

  static object Batch(Dictionary<string,object> a) {
    object raw;if(!a.TryGetValue("steps",out raw)||!(raw is System.Collections.IEnumerable))throw new Exception("steps array required");
    var results=new List<object>(); int idx=0;
    foreach(object o in (System.Collections.IEnumerable)raw){
      var step=D(o); string action=S(step,"action",""); var sw=Stopwatch.StartNew();
      try{var res=Execute(action,step);results.Add(new Dictionary<string,object>{{"index",idx},{"action",action},{"ok",true},{"elapsedMs",sw.ElapsedMilliseconds},{"result",res}});}
      catch(Exception ex){results.Add(new Dictionary<string,object>{{"index",idx},{"action",action},{"ok",false},{"elapsedMs",sw.ElapsedMilliseconds},{"error",ex.Message}});if(ex.Message.Contains("USER_APPROVAL_REQUIRED")||!B(a,"continueOnError",false))break;}
      idx++;
    }
    return new Dictionary<string,object>{{"results",results},{"count",results.Count}};
  }

  [STAThread]
  public static void Main() {
    try { AttachInputDesktop(); } catch {}
    Console.InputEncoding=Encoding.UTF8; Console.OutputEncoding=Encoding.UTF8;
    string line;
    while((line=Console.ReadLine())!=null){
      if(String.IsNullOrWhiteSpace(line))continue;
      string id=""; var total=Stopwatch.StartNew();
      try{
        var req=js.Deserialize<Dictionary<string,object>>(line); id=S(req,"id",""); string action=S(req,"action",""); object argsObj; var args=req.TryGetValue("args",out argsObj)?D(argsObj):req;
        object result=action=="batch"?Batch(args):Execute(action,args);
        Console.WriteLine(js.Serialize(new Dictionary<string,object>{{"id",id},{"ok",true},{"elapsedMs",total.ElapsedMilliseconds},{"result",result}}));
      }catch(Exception ex){
        Console.WriteLine(js.Serialize(new Dictionary<string,object>{{"id",id},{"ok",false},{"elapsedMs",total.ElapsedMilliseconds},{"error",ex.GetType().Name+": "+ex.Message}}));
      }
      Console.Out.Flush();
    }
  }
}
