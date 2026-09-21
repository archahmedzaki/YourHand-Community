$ErrorActionPreference='Stop'
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
$src=Join-Path $root 'YourHandNative.cs'
$out=Join-Path $root 'YourHandNative.exe'
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$uac=(Get-ChildItem (Join-Path $env:WINDIR 'Microsoft.NET\assembly\GAC_MSIL\UIAutomationClient') -Recurse -Filter UIAutomationClient.dll | Select-Object -First 1 -ExpandProperty FullName)
$uat=(Get-ChildItem (Join-Path $env:WINDIR 'Microsoft.NET\assembly\GAC_MSIL\UIAutomationTypes') -Recurse -Filter UIAutomationTypes.dll | Select-Object -First 1 -ExpandProperty FullName)
$wb=(Get-ChildItem (Join-Path $env:WINDIR 'Microsoft.NET\assembly\GAC_MSIL\WindowsBase') -Recurse -Filter WindowsBase.dll | Select-Object -First 1 -ExpandProperty FullName)
& $csc /nologo /optimize+ /target:exe /out:$out /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /r:$uac /r:$uat /r:$wb $src
if($LASTEXITCODE -ne 0){throw 'YourHandNative build failed'}
Get-FileHash $out -Algorithm SHA256
