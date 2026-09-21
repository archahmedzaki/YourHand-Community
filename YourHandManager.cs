using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Drawing;
using System.Diagnostics;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
class YourHandManager : Form {
 static readonly string Root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"YourHand");
 static readonly string Installed=Path.Combine(Root,"YourHandManager.exe");
 static readonly string AppKey=@"Software\Microsoft\Windows\CurrentVersion\Uninstall\YourHand";
 static readonly string RunKey=@"Software\Microsoft\Windows\CurrentVersion\Run";
 static readonly string Shortcut=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"YourHand Device Manager.lnk");
 static readonly string ShortcutMarker=Path.Combine(Root,".manager-shortcut-created");
 const string Dashboard="https://yourhand.wolvexai.com/";
 Label status,service,device,accounts,note;
 Button start,stop;
 NotifyIcon tray;
 System.Windows.Forms.Timer refresh;
 static bool Same(string a,string b){try{return String.Equals(Path.GetFullPath(a),Path.GetFullPath(b),StringComparison.OrdinalIgnoreCase);}catch{return false;}}
 static void Go(string address){Process.Start(new ProcessStartInfo(address){UseShellExecute=true});}
 static Process[] Agents(){
  return Process.GetProcessesByName("node").Where(p=>{try{return Same(p.MainModule.FileName,Path.Combine(Root,"node.exe"));}catch{return false;}}).ToArray();
 }
 static string Id(){
  try{
   string text=File.ReadAllText(Path.Combine(Root,"yourhand-config.json"));
   var obj=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(text);
   object val;return obj.TryGetValue("deviceId",out val)?Convert.ToString(val):"Not paired";
  }catch{return "Not paired";}
 }
 static void Register(){
  using(var key=Registry.CurrentUser.CreateSubKey(AppKey)){
   key.SetValue("DisplayName","YourHand",RegistryValueKind.String);
   key.SetValue("Publisher","YourHand",RegistryValueKind.String);
   key.SetValue("DisplayVersion","0.9.1",RegistryValueKind.String);
   key.SetValue("InstallLocation",Root,RegistryValueKind.String);
   key.SetValue("DisplayIcon",Installed,RegistryValueKind.String);
   key.SetValue("UninstallString","\""+Installed+"\" /uninstall",RegistryValueKind.String);
   key.SetValue("NoModify",1,RegistryValueKind.DWord);
   key.SetValue("NoRepair",1,RegistryValueKind.DWord);
  }
  using(var key=Registry.CurrentUser.CreateSubKey(RunKey))key.SetValue("YourHandManager","\""+Installed+"\" /tray",RegistryValueKind.String);
  try{
   if(!File.Exists(Shortcut)){
    Type t=Type.GetTypeFromProgID("WScript.Shell");
    object shell=Activator.CreateInstance(t);
    object link=t.InvokeMember("CreateShortcut",System.Reflection.BindingFlags.InvokeMethod,null,shell,new object[]{Shortcut});
    link.GetType().InvokeMember("TargetPath",System.Reflection.BindingFlags.SetProperty,null,link,new object[]{Installed});
    link.GetType().InvokeMember("WorkingDirectory",System.Reflection.BindingFlags.SetProperty,null,link,new object[]{Root});
    link.GetType().InvokeMember("Description",System.Reflection.BindingFlags.SetProperty,null,link,new object[]{"YourHand Device Manager"});
    link.GetType().InvokeMember("Save",System.Reflection.BindingFlags.InvokeMethod,null,link,new object[]{});
    File.WriteAllText(ShortcutMarker,"YourHand");
   }
  }catch{}

 }
 static void Install(){
  Directory.CreateDirectory(Root);
  if(!Same(Application.ExecutablePath,Installed)){
   try{File.Copy(Application.ExecutablePath,Installed,true);}
   catch(IOException){if(!File.Exists(Installed))throw;}
   Register();
   Process.Start(new ProcessStartInfo(Installed,"/open"){WorkingDirectory=Root,UseShellExecute=false});
   return;
  }
  Register();
  Application.Run(new YourHandManager());
 }
 static void Uninstall(){
  if(MessageBox.Show("Remove YourHand Agent, manager and local device keys from THIS Windows account? Any running remote task will stop. Server-side device access must be revoked separately in the web dashboard.","Uninstall YourHand",MessageBoxButtons.YesNo,MessageBoxIcon.Warning)!=DialogResult.Yes)return;
  foreach(var proc in Agents())try{proc.Kill();proc.WaitForExit(4500);}catch{}finally{proc.Dispose();}
  using(var run=Registry.CurrentUser.OpenSubKey(RunKey,true)){
   if(run!=null){
    foreach(string name in new[]{"YourHandManager","YourHand"}){
     var val=Convert.ToString(run.GetValue(name,""));
     if(val.IndexOf(Root,StringComparison.OrdinalIgnoreCase)>=0)run.DeleteValue(name,false);
    }
   }
  }
  Registry.CurrentUser.DeleteSubKeyTree(AppKey,false);
  try{if(File.Exists(ShortcutMarker)&&File.Exists(Shortcut))File.Delete(Shortcut);}catch{}

  string helper=Path.Combine(Path.GetTempPath(),"YourHandUninstall-"+Guid.NewGuid().ToString("N")+".exe");
  File.Copy(Application.ExecutablePath,helper);
  Process.Start(new ProcessStartInfo(helper,"/finish-uninstall "+Process.GetCurrentProcess().Id){UseShellExecute=false,CreateNoWindow=true});
 }
 static void FinishUninstall(int parent){
  try{Process.GetProcessById(parent).WaitForExit(12000);}catch{}
  if(Same(Root,Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"YourHand")) && Directory.Exists(Root)){
   for(int attempt=0;attempt<18;attempt++){
    try{
     if((new DirectoryInfo(Root).Attributes&FileAttributes.ReparsePoint)!=0)break;
     Directory.Delete(Root,true);break;
    }catch{Thread.Sleep(1000);}
   }
  }
 }
 [STAThread]static void Main(string[] args){
  Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
  try {
   if(args.Length>0 && args[0]=="/finish-uninstall"){int n;if(args.Length>1&&int.TryParse(args[1],out n))FinishUninstall(n);return;}
   if(args.Length>0 && args[0]=="/uninstall"){Uninstall();return;}
   if(!Same(Application.ExecutablePath,Installed)){Install();return;}
   bool created;using(var mutex=new Mutex(true,@"Local\YourHandManagerUI",out created)){
    if(!created){if(args.Length==0||args[0]!="/tray")MessageBox.Show("YourHand is already running. Open it from the icon near the Windows clock.","YourHand");return;}
    Register();Application.Run(new YourHandManager(args.Length>0 && args[0]=="/tray"));
   }
  }catch(Exception e){MessageBox.Show(e.Message,"YourHand Manager",MessageBoxButtons.OK,MessageBoxIcon.Error);}
 }
 YourHandManager(bool hidden=false){
  Text="YourHand | Device Manager";Width=560;Height=410;MinimumSize=new Size(490,385);
  StartPosition=FormStartPosition.CenterScreen;BackColor=Color.FromArgb(12,22,37);ForeColor=Color.FromArgb(232,245,255);
  Font=new Font("Segoe UI",10);
  FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;
  var heading=new Label(){Text="YourHand",Font=new Font("Segoe UI",22,FontStyle.Bold),Left=22,Top=14,Width=380,Height=50,ForeColor=Color.FromArgb(102,214,250)};
  Controls.Add(heading);
  status=MakeLabel("Agent: checking",70);service=MakeLabel("YourHand service: checking",104);
  device=MakeLabel("Device ID: checking",138);accounts=MakeLabel("Accounts: use Dashboard > Share to invite other Google users to THIS Device ID.",172);
  note=MakeLabel("One Agent per Windows profile, many invited Google accounts. For a second Google account, use Share on the owner dashboard; do not reinstall this Agent.",209);
  note.Width=510;note.Height=41;note.Font=new Font("Segoe UI",9);
  start=MakeButton("Start Agent",22,260,120,(s,e)=>StartAgent());
  stop=MakeButton("Stop Agent",148,260,120,(s,e)=>StopAgent());
  MakeButton("Open Dashboard / Accounts",274,260,258,(s,e)=>Go(Dashboard));
  MakeButton("Uninstall YourHand",22,305,180,(s,e)=>{Uninstall();Application.Exit();});
  MakeButton("Refresh",210,305,102,(s,e)=>RefreshStatus());
  MakeButton("Close to tray",320,305,212,(s,e)=>Hide());
  tray=new NotifyIcon(){Text="YourHand Device Manager",Icon=SystemIcons.Application,Visible=true};
  var menu=new ContextMenuStrip();
  menu.Items.Add(new ToolStripMenuItem("Open YourHand",null,(s,e)=>ShowManager()));
  menu.Items.Add(new ToolStripMenuItem("Manage accounts",null,(s,e)=>Go(Dashboard)));
  menu.Items.Add(new ToolStripMenuItem("Start Agent",null,(s,e)=>StartAgent()));
  menu.Items.Add(new ToolStripMenuItem("Stop Agent",null,(s,e)=>StopAgent()));
  menu.Items.Add(new ToolStripMenuItem("Exit manager (Agent stays running)",null,(s,e)=>{tray.Visible=false;Application.Exit();}));
  tray.ContextMenuStrip=menu;tray.DoubleClick+=(s,e)=>ShowManager();
  refresh=new System.Windows.Forms.Timer(){Interval=12000};refresh.Tick+=(s,e)=>RefreshStatus();refresh.Start();
  Shown+=(s,e)=>{RefreshStatus();if(hidden)Hide();};
  FormClosing+=(s,e)=>{if(e.CloseReason==CloseReason.UserClosing){e.Cancel=true;Hide();}};
 }
 Label MakeLabel(string text,int top){var l=new Label(){Text=text,Left=24,Top=top,Width=510,Height=31,AutoEllipsis=true};Controls.Add(l);return l;}
 Button MakeButton(string text,int left,int top,int width,EventHandler click){
  var b=new Button(){Text=text,Left=left,Top=top,Width=width,Height=37,BackColor=Color.FromArgb(25,55,78),ForeColor=Color.White,FlatStyle=FlatStyle.Flat};
  b.Click+=click;Controls.Add(b);return b;
 }
 void ShowManager(){Show();WindowState=FormWindowState.Normal;Activate();RefreshStatus();}
 void RefreshStatus(){
  // Uninstaller invoked from Installed Apps asks the already-open tray UI to exit.
  using(var installedKey=Registry.CurrentUser.OpenSubKey(AppKey)){
   if(installedKey==null){tray.Visible=false;Application.Exit();return;}
  }
  var ps=Agents();bool running=ps.Length>0;
  foreach(var p in ps)p.Dispose();
  status.Text="Agent: "+(running?"RUNNING":"STOPPED");
  status.ForeColor=running?Color.LightGreen:Color.Orange;
  string id=Id();device.Text="Device ID: "+id;
  start.Enabled=!running && File.Exists(Path.Combine(Root,"node.exe")) && File.Exists(Path.Combine(Root,"yourhand-agent.mjs"));
  stop.Enabled=running;
  ThreadPool.QueueUserWorkItem(_=>{
   string state;
   try{
    var request=(HttpWebRequest)WebRequest.Create(Dashboard+"health");
    request.Timeout=4500;request.ReadWriteTimeout=4500;
    using(var response=(HttpWebResponse)request.GetResponse())state=response.StatusCode==HttpStatusCode.OK?"REACHABLE":"UNAVAILABLE";
   }catch{state="UNAVAILABLE";}
   try{if(IsHandleCreated)BeginInvoke((Action)(()=>service.Text="YourHand cloud service: "+state+" (not a device-command test)"));}catch{}
  });
 }
 void StartAgent(){
  if(Agents().Length>0)return;
  string exe=Path.Combine(Root,"node.exe"),agent=Path.Combine(Root,"yourhand-agent.mjs");
  if(!File.Exists(exe)||!File.Exists(agent)){MessageBox.Show("Agent is not installed. Get the Windows setup from the YourHand dashboard.");Go(Dashboard);return;}
  try{Process.Start(new ProcessStartInfo(exe,"\""+agent+"\""){WorkingDirectory=Root,UseShellExecute=false,CreateNoWindow=true});}
  catch(Exception ex){MessageBox.Show(ex.Message,"Unable to start Agent");}
  RefreshStatus();
 }
 void StopAgent(){
  var ps=Agents();
  if(ps.Length==0){RefreshStatus();return;}
  if(MessageBox.Show("Stop receiving remote commands now? Active tasks and ongoing remote sessions on this computer will be interrupted. Continue?","Stop YourHand Agent",MessageBoxButtons.YesNo,MessageBoxIcon.Warning)!=DialogResult.Yes){
   foreach(var p in ps)p.Dispose();return;
  }
  foreach(var p in ps)try{p.Kill();p.WaitForExit(4000);}catch(Exception ex){MessageBox.Show(ex.Message,"Could not stop Agent");}finally{p.Dispose();}
  RefreshStatus();
 }
 protected override void OnFormClosed(FormClosedEventArgs e){
  if(refresh!=null){refresh.Stop();refresh.Dispose();}
  if(tray!=null){tray.Visible=false;tray.Dispose();}
  base.OnFormClosed(e);
 }
}
