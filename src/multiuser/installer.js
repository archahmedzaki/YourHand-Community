'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');

const csString = value => String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"');

function buildWindowsInstaller({ token, baseUrl, bundleSha256, agentUrl }) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yourhand-setup-'));
    const source = path.join(dir, 'YourHandSetup.cs');
    const output = path.join(dir, 'YourHand-Setup.exe');
    const rootUrl = baseUrl.replace(/\/$/, '');
    const bundleUrl = rootUrl + '/downloads/YourHandAgent.zip?sha=' + encodeURIComponent(String(bundleSha256||''));
    const enrollUrl = rootUrl + '/api/device/enroll';
    const managerUrl = rootUrl + '/YourHand-Manager-Install.exe';
    const managerPath = path.join(__dirname,'../../web/YourHand-Manager-Install.exe');
    if(!fs.existsSync(managerPath))throw new Error('Windows GUI manager not bundled');
    const managerSha256=crypto.createHash('sha256').update(fs.readFileSync(managerPath)).digest('hex');
    agentUrl = agentUrl || ((new URL(rootUrl).protocol === 'https:' ? 'wss://' : 'ws://') + new URL(rootUrl).host + '/agent');
    const code = `using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Threading;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using Microsoft.Win32;
using System.Windows.Forms;

class YourHandSetup {
  static string Sha256(string file) { using(var sha=SHA256.Create()) using(var s=File.OpenRead(file)) return BitConverter.ToString(sha.ComputeHash(s)).Replace("-","").ToLowerInvariant(); }
  static bool IsAgentRunning(string root) {
    string ownNode=Path.GetFullPath(Path.Combine(root,"node.exe"));
    foreach(var p in Process.GetProcessesByName("node")) {
      try {
        string exe=Path.GetFullPath(p.MainModule.FileName);
        if(String.Equals(exe,ownNode,StringComparison.OrdinalIgnoreCase) && !p.HasExited)return true;
      } catch(System.ComponentModel.Win32Exception) {} catch(InvalidOperationException) {} finally {p.Dispose();}
    }
    return false;
  }
  static void CopyTree(string source,string target,string backupRoot,
      List<string> created,List<string> backed) {
    string fullRoot=Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
    foreach(var file in Directory.GetFiles(source,"*",SearchOption.AllDirectories)) {
      string rel=file.Substring(source.Length).TrimStart(Path.DirectorySeparatorChar);
      string dest=Path.GetFullPath(Path.Combine(target,rel));
      if(!dest.StartsWith(fullRoot,StringComparison.OrdinalIgnoreCase))
        throw new IOException("Unsafe package path");
      if(File.Exists(dest)){
        string backup=Path.Combine(backupRoot,rel);
        Directory.CreateDirectory(Path.GetDirectoryName(backup));
        File.Copy(dest,backup,false);backed.Add(rel);
      }else created.Add(rel);
    }
    foreach(var file in Directory.GetFiles(source,"*",SearchOption.AllDirectories)) {
      string rel=file.Substring(source.Length).TrimStart(Path.DirectorySeparatorChar);
      string dest=Path.GetFullPath(Path.Combine(target,rel));
      Directory.CreateDirectory(Path.GetDirectoryName(dest));
      File.Copy(file,dest,true);
    }
  }
  static void RollbackRuntime(string root,string backupRoot,List<string> created,List<string> backed) {
    foreach(string rel in created) {
      string file=Path.Combine(root,rel);
      if(File.Exists(file))File.Delete(file);
    }
    foreach(string rel in backed){
      string backup=Path.Combine(backupRoot,rel);
      string file=Path.Combine(root,rel);
      Directory.CreateDirectory(Path.GetDirectoryName(file));
      File.Copy(backup,file,true);
    }
  }

  static bool EnsureManager(string root) {
    string current=Path.Combine(root,"YourHandManager.exe");
    if(File.Exists(current)) {
      // Never replace an in-use GUI binary; existing UI still manages this Agent.
      Process.Start(new ProcessStartInfo(current){UseShellExecute=true,WorkingDirectory=root});
      return true;
    }
    string download=Path.Combine(Path.GetTempPath(),"YourHandManager-"+Guid.NewGuid().ToString("N")+".exe");
    using(var wc=new WebClient()){
      wc.Headers.Add("User-Agent","YourHand-Setup/1.0");
      wc.DownloadFile("${csString(managerUrl)}",download);
    }
    if(!String.Equals(Sha256(download),"${csString(managerSha256)}",StringComparison.OrdinalIgnoreCase))
      throw new Exception("Windows GUI download integrity check failed");
    // GUI installs itself into this Windows user's LocalAppData, registers
    // Installed Apps + Start Menu and opens without stopping the live Agent.
    Process.Start(new ProcessStartInfo(download){UseShellExecute=true,WorkingDirectory=root});
    return true;
  }

  [STAThread]
  static int Main() {
    string zip=null,temp=null,backup=null;
    bool runtimeChanged=false,rollbackSucceeded=false,agentStarted=false;
    var created=new List<string>();var backed=new List<string>();
    try {
      ServicePointManager.SecurityProtocol=(SecurityProtocolType)3072;
      string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"YourHandCommunity");
      Directory.CreateDirectory(root);
      // A single active Agent belongs to the PC, not the account downloading Setup.
      // Never overwrite a running executable/agent or replace its paired device identity.
      if(IsAgentRunning(root)) {
        EnsureManager(root);
        MessageBox.Show("YourHand is running: its Windows app is now opening. The Agent and existing tasks remain untouched. To add another Google account, use Share on the device owner's dashboard.", "YourHand — Windows app installed", MessageBoxButtons.OK,MessageBoxIcon.Information);
        return 0;
      }
      bool existingDevice=File.Exists(Path.Combine(root,"yourhand-config.json"));
      zip=Path.Combine(Path.GetTempPath(),"YourHandAgent-"+Guid.NewGuid().ToString("N")+".zip");
      temp=Path.Combine(Path.GetTempPath(),"YourHandAgent-"+Guid.NewGuid().ToString("N"));
      Directory.CreateDirectory(temp);
      using(var wc=new WebClient()) {
        wc.Headers.Add("User-Agent","YourHand-Setup/0.9");
        wc.DownloadFile("${csString(bundleUrl)}",zip);
      }
      if(!String.Equals(Sha256(zip),"${csString(bundleSha256)}",StringComparison.OrdinalIgnoreCase)) throw new Exception("Agent package integrity check failed");
      ZipFile.ExtractToDirectory(zip,temp);
      // Check again after download; another installer or auto-start may have launched the Agent.
      if(IsAgentRunning(root))throw new OperationCanceledException("YourHand started while downloading. No files changed; close the installer and use Share for another account.");
      backup=Path.Combine(Path.GetTempPath(),"YourHandRuntimeBackup-"+Guid.NewGuid().ToString("N"));
      Directory.CreateDirectory(backup);
      runtimeChanged=true; // Rollback even after a partial copy failure.
      CopyTree(temp,root,backup,created,backed);
      string bootstrap="{\\\"pairingToken\\\":\\\"${csString(token)}\\\",\\\"enrollUrl\\\":\\\"${csString(enrollUrl)}\\\",\\\"serverUrl\\\":\\\"${csString(agentUrl)}\\\",\\\"disableDesktopCommander\\\":true}";
      // Community installs carry their own Core origin; never default to the official dashboard.
      string communityDashboard=Path.Combine(root,"community-dashboard-url.txt");
      if(!File.Exists(communityDashboard))File.WriteAllText(communityDashboard,"${csString(rootUrl + '/')}");
      // Existing Community device identity survives repair/update; only new installs need enrollment.
      if(!File.Exists(Path.Combine(root,"yourhand-config.json")))File.WriteAllText(Path.Combine(root,"yourhand-bootstrap.json"),bootstrap);
      string node=Path.Combine(root,"node.exe");
      string agent=Path.Combine(root,"yourhand-agent.mjs");
      string command="\\\""+node+"\\\" \\\""+agent+"\\\"";
      using(var key=Registry.CurrentUser.CreateSubKey(@"Software\\Microsoft\\Windows\\CurrentVersion\\Run")) key.SetValue("YourHandCommunity",command,RegistryValueKind.String);
      var psi=new ProcessStartInfo(node,"\\\""+agent+"\\\"") { UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=root,WindowStyle=ProcessWindowStyle.Hidden };
      Process.Start(psi);
      agentStarted=true;
      Thread.Sleep(1800);
      if(!IsAgentRunning(root))
        throw new Exception("The updated Agent did not remain running. Runtime rollback will restore the previous files.");
      // A transient 502 for the optional GUI must not roll back a healthy
      // running Agent or replace a paired device identity.
      try{EnsureManager(root);}
      catch(Exception managerError){
        MessageBox.Show("Agent is running but the Windows GUI could not be downloaded: "+managerError.Message+
          "\\nYou can retry the standalone GUI download from the YourHand dashboard without stopping the Agent.",
          "YourHand - Agent remains running",MessageBoxButtons.OK,MessageBoxIcon.Warning);
      }
      if(existingDevice)MessageBox.Show("YourHand Agent updated using the existing device identity. To link another Google account, open Share on the owner's dashboard and invite that email. Do not install a second Agent.","YourHand",MessageBoxButtons.OK,MessageBoxIcon.Information);
      return 0;
    } catch(Exception ex) {
      string notice=ex.Message;
      if(runtimeChanged && !IsAgentRunning(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"YourHandCommunity"))){
        try{
          RollbackRuntime(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"YourHandCommunity"),
            backup,created,backed);
          rollbackSucceeded=true;notice+="\\nPrevious runtime files restored. Existing device configuration was not replaced.";
        }catch(Exception restoreError){
          notice+="\\nRuntime rollback incomplete. Preserve the backup and contact support: "+restoreError.Message;
        }
      }
      MessageBox.Show("YourHand setup could not finish.\\n\\n"+notice,"YourHand",MessageBoxButtons.OK,MessageBoxIcon.Error);
      return 1;
    } finally {
      try{if(zip!=null&&File.Exists(zip))File.Delete(zip);}catch{}
      try{if(temp!=null&&Directory.Exists(temp))Directory.Delete(temp,true);}catch{}
      // Never delete the backup when rollback failed; it is the only local
      // recovery copy. Successful installs or successful rollback may clean it.
      if(!runtimeChanged||rollbackSucceeded||(agentStarted&&IsAgentRunning(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"YourHandCommunity")))){
        try{if(backup!=null&&Directory.Exists(backup))Directory.Delete(backup,true);}catch{}
      }
    }
  }
} `;
    fs.writeFileSync(source, code, 'utf8');
    const csc = process.env.YOURHAND_CSC || 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
    const args = ['/nologo','/optimize+','/target:winexe','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll','/reference:System.Windows.Forms.dll','/out:'+output,source];
    execFile(csc,args,{windowsHide:true,timeout:90000},(error,stdout,stderr)=>{
      if(error){ try{fs.rmSync(dir,{recursive:true,force:true});}catch{}; return reject(new Error('Installer build failed: '+(stderr||stdout||error.message))); }
      resolve({ output, cleanup:()=>{ try{fs.rmSync(dir,{recursive:true,force:true});}catch{} } });
    });
  });
}

module.exports = { buildWindowsInstaller };