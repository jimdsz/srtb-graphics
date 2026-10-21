using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// No elevation, autorun, firewall rule, certificate installation or persistent
// capability. The pipe owns the Node lifetime; quitting releases it.
internal static class Launcher {
 [STAThread] private static int Main(string[] args) {
  try {
   VerifyPackage();
   if(args.Length==1 && args[0]=="--verify-only") return 0;
   if(args.Length!=0) return 2;
   bool first;string sid=WindowsIdentity.GetCurrent().User.Value;
   using(var mutex=new Mutex(true,@"Local\SRTB.Graphics.Connector."+sid,out first)) {
    if(!first){MessageBox.Show("Le connecteur est déjà ouvert. Utilisez son icône près de l’horloge pour retrouver les autorisations.","Graphics");return 0;}
    Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
    using(var context=new ConnectorContext()) Application.Run(context);
    mutex.ReleaseMutex();
   }
   return 0;
  } catch(Exception) {
   if(args.Length!=0)return 1;
   MessageBox.Show("Le paquet du connecteur est incomplet, modifié ou inaccessible. Ne désactivez pas les protections Windows. Contactez votre support.","Connecteur Graphics",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;
  }
 }
 private static void VerifyPackage() {
  string root=AppDomain.CurrentDomain.BaseDirectory;
  using(var stream=typeof(Launcher).Assembly.GetManifestResourceStream("payload-hashes.json"))
  using(var reader=new StreamReader(stream)) {
   var hashes=new JavaScriptSerializer().Deserialize<Dictionary<string,string>>(reader.ReadToEnd());
   foreach(var pair in hashes) {
    if(!Regex.IsMatch(pair.Key,@"^[a-zA-Z0-9_./-]+$")||pair.Key.Contains(".."))throw new InvalidDataException();
    string target=Path.GetFullPath(Path.Combine(root,pair.Key));
    if(!target.StartsWith(root,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException();
    using(var input=File.OpenRead(target))using(var sha=SHA256.Create()) {
     string actual=BitConverter.ToString(sha.ComputeHash(input)).Replace("-","").ToLowerInvariant();
     if(actual!=pair.Value)throw new InvalidDataException();
    }
   }
  }
 }
 private sealed class ConnectorContext : ApplicationContext {
  private Process child;private NotifyIcon tray;private string consoleUrl;private bool stopping;
  private readonly Control dispatcher=new Control();private readonly System.Windows.Forms.Timer startup=new System.Windows.Forms.Timer();
  internal ConnectorContext() {
   dispatcher.CreateControl();IntPtr unused=dispatcher.Handle;
   var menu=new ContextMenuStrip();
   menu.Items.Add("Ouvrir les autorisations",null,(s,e)=>OpenConsole());
   menu.Items.Add("Ouvrir Graphics",null,(s,e)=>OpenUrl("https://srtb-graphics.pages.dev/graphics"));
   menu.Items.Add(new ToolStripSeparator());menu.Items.Add("Arrêter le connecteur",null,(s,e)=>Stop());
   tray=new NotifyIcon{Icon=SystemIcons.Application,Text="Graphics · démarrage",ContextMenuStrip=menu,Visible=true};
   tray.DoubleClick+=(s,e)=>OpenConsole();
   string root=AppDomain.CurrentDomain.BaseDirectory;
   var info=new ProcessStartInfo(Path.Combine(root,"node.exe"),"\""+Path.Combine(root,"connector","main.mjs")+"\" --desktop") {
    UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,
    RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,WorkingDirectory=root,
    StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8
   };
   info.EnvironmentVariables.Remove("NODE_OPTIONS");info.EnvironmentVariables.Remove("NODE_PATH");
   child=new Process{StartInfo=info,EnableRaisingEvents=true};
   child.OutputDataReceived+=(s,e)=>{if(e.Data!=null)Post(()=>Ready(e.Data));};
   child.ErrorDataReceived+=(s,e)=>{/* Do not persist paths, media metadata or capabilities. */};
   child.Exited+=(s,e)=>Post(()=>{if(!stopping){if(consoleUrl==null)MessageBox.Show("Démarrage impossible : le port local est peut-être déjà occupé. Fermez l’autre instance puis réessayez.","Graphics");ExitThread();}});
   startup.Interval=15000;startup.Tick+=(s,e)=>{startup.Stop();if(consoleUrl==null){MessageBox.Show("Le connecteur ne répond pas au démarrage. Il va être arrêté ; vous pouvez continuer dans Graphics sans connecteur.","Graphics");Stop();}};
   try{child.Start();child.BeginOutputReadLine();child.BeginErrorReadLine();startup.Start();}
   catch{tray.Dispose();startup.Dispose();dispatcher.Dispose();throw;}
  }
  private void Post(Action action){if(!dispatcher.IsDisposed)try{dispatcher.BeginInvoke(action);}catch(InvalidOperationException){}}
  private void Ready(string line) {
   if(consoleUrl!=null||stopping)return;
   try{
    var data=new JavaScriptSerializer().Deserialize<Dictionary<string,string>>(line);
    string url;if(data["type"]!="ready"||!data.TryGetValue("consoleURL",out url)||!Regex.IsMatch(url,@"^http://127\.0\.0\.1:43871/#[a-f0-9]{64}$"))return;
    consoleUrl=url;startup.Stop();tray.Text="Graphics · connecteur local";OpenConsole();
   }catch{/* Invalid child output cannot open an arbitrary URL. */}
  }
  private void OpenConsole(){if(consoleUrl!=null)OpenUrl(consoleUrl);}
  private static void OpenUrl(string url){try{Process.Start(new ProcessStartInfo(url){UseShellExecute=true});}catch{MessageBox.Show("Impossible d’ouvrir le navigateur par défaut. Vérifiez sa configuration.","Graphics");}}
  private async void Stop() {
   if(stopping)return;stopping=true;startup.Stop();tray.Text="Graphics · arrêt en cours";
   // EOF on the private pipe is also an authenticated ownership/lifetime signal.
   try{child.StandardInput.Close();}catch{}
   await Task.Run(()=>{try{if(!child.WaitForExit(7000))child.Kill();}catch{}});
   ExitThread();
  }
  protected override void ExitThreadCore(){startup.Stop();tray.Visible=false;try{child.StandardInput.Close();}catch{}base.ExitThreadCore();}
  protected override void Dispose(bool disposing){if(disposing){tray.Dispose();startup.Dispose();dispatcher.Dispose();child.Dispose();}base.Dispose(disposing);}
 }
}
