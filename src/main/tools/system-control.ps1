$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
try {
  if ($request.operation -in @('audio', 'volume')) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
namespace SophonAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class Enumerator {}
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDevices {
    void EnumAudioEndpoints(int flow, uint mask, out ICollection devices);
    void GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
    void GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IDevice device);
  }
  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ICollection { void GetCount(out uint count); void Item(uint index, out IDevice device); }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDevice {
    void Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object value);
    void OpenPropertyStore(uint access, out IntPtr store);
    void GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    void GetState(out uint state);
  }
  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IEndpoint {
    void RegisterControlChangeNotify(IntPtr p); void UnregisterControlChangeNotify(IntPtr p);
    void GetChannelCount(out uint count); void SetMasterVolumeLevel(float level, ref Guid context);
    void SetMasterVolumeLevelScalar(float level, ref Guid context);
    void GetMasterVolumeLevel(out float level); void GetMasterVolumeLevelScalar(out float level);
    void SetChannelVolumeLevel(uint channel, float level, ref Guid context);
    void SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
    void GetChannelVolumeLevel(uint channel, out float level);
    void GetChannelVolumeLevelScalar(uint channel, out float level);
    void SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    void GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IManager {
    void GetAudioSessionControl(ref Guid id, uint flags, out IntPtr control);
    void GetSimpleAudioVolume(ref Guid id, uint flags, out IntPtr volume);
    void GetSessionEnumerator(out ISessions sessions);
  }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISessions { void GetCount(out int count); void GetSession(int index, out ISession session); }
  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISession {
    void GetState(out int state);
    void GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
    void GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    void SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
    void GetGroupingParam(out Guid group); void SetGroupingParam(ref Guid group, ref Guid context);
    void RegisterAudioSessionNotification(IntPtr p); void UnregisterAudioSessionNotification(IntPtr p);
    void GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    void GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    void GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
  }
  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IVolume {
    void SetMasterVolume(float level, ref Guid context); void GetMasterVolume(out float level);
    void SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    void GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }
  public class Row {
    public string endpoint, session, name; public uint pid; public double volume; public bool muted;
  }
  public static class Audio {
    static object Activate(IDevice device, Type type) {
      Guid id = type.GUID; object value; device.Activate(ref id, 23, IntPtr.Zero, out value); return value;
    }
    static void Apply(IVolume v, double? level, bool? mute) {
      Guid context = Guid.Empty;
      if (level.HasValue) v.SetMasterVolume((float)(level.Value / 100), ref context);
      if (mute.HasValue) v.SetMute(mute.Value, ref context);
    }
    public static Row[] Run(bool write, string endpoint, string session, double? level, bool? mute) {
      if (level.HasValue && (double.IsNaN(level.Value) || level < 0 || level > 100)) throw new Exception("Invalid volume.");
      var devices = (IDevices)new Enumerator();
      var rows = new List<Row>();
      if (!write || session == "") {
        IDevice device;
        if (write) devices.GetDevice(endpoint, out device); else devices.GetDefaultAudioEndpoint(0, 1, out device);
        string id; device.GetId(out id);
        var v = (IEndpoint)Activate(device, typeof(IEndpoint));
        Guid context = Guid.Empty;
        if (write && level.HasValue) v.SetMasterVolumeLevelScalar((float)(level.Value / 100), ref context);
        if (write && mute.HasValue) v.SetMute(mute.Value, ref context);
        float volume; bool muted; v.GetMasterVolumeLevelScalar(out volume); v.GetMute(out muted);
        rows.Add(new Row { endpoint = id, session = "", name = "system", volume = Math.Round(volume * 100, 2), muted = muted });
        if (write) return rows.ToArray();
      }
      ICollection collection; devices.EnumAudioEndpoints(0, 1, out collection);
      uint count; collection.GetCount(out count);
      for (uint i = 0; i < count; i++) {
        IDevice device; collection.Item(i, out device); string id; device.GetId(out id);
        if (write && id != endpoint) continue;
        var manager = (IManager)Activate(device, typeof(IManager));
        ISessions sessions; manager.GetSessionEnumerator(out sessions); int n; sessions.GetCount(out n);
        for (int j = 0; j < n; j++) {
          ISession control; sessions.GetSession(j, out control);
          int state; control.GetState(out state); if (state == 2) continue;
          string instance; control.GetSessionInstanceIdentifier(out instance);
          if (write && instance != session) continue;
          uint pid; control.GetProcessId(out pid);
          string name = "system sounds";
          if (pid != 0) { try { using (var p = Process.GetProcessById((int)pid)) name = p.ProcessName + ".exe"; } catch { continue; } }
          var v = (IVolume)control;
          if (write) Apply(v, level, mute);
          float volume; bool muted; v.GetMasterVolume(out volume); v.GetMute(out muted);
          rows.Add(new Row { endpoint = id, session = instance, pid = pid, name = name, volume = Math.Round(volume * 100, 2), muted = muted });
          if (write) return rows.ToArray();
        }
      }
      if (write) throw new Exception("The approved audio session disappeared. List audio again.");
      return rows.ToArray();
    }
  }
}
'@
    $level = $null; $mute = $null
    if ($null -ne $request.volume) { $level = [double]$request.volume }
    if ($null -ne $request.muted) { $mute = [bool]$request.muted }
    $result = @([SophonAudio.Audio]::Run($request.operation -eq 'volume', [string]$request.endpoint, [string]$request.session, $level, $mute))
  } elseif ($request.operation -in @('radios', 'radio')) {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime]
    $null = [Windows.Devices.Radios.RadioAccessStatus,Windows.System.Devices,ContentType=WindowsRuntime]
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
    function Await($operation, $type) {
      $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
      if (-not $task.Wait(5000)) { throw 'Windows radio operation timed out; inspect state before retrying.' }
      return $task.Result
    }
    $radios = @(Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]))
    if ($request.operation -eq 'radio') {
      $target = @($radios | Where-Object { [string]$_.Kind -eq $request.kind -and $_.Name -ceq $request.name })
      if ($target.Count -ne 1) { throw 'The approved radio is missing or ambiguous. List radios again.' }
      $access = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
      if ([string]$access -ne 'Allowed') { throw "Windows refused radio access: $access" }
      $state = [Windows.Devices.Radios.RadioState]::Off
      if ($request.enabled) { $state = [Windows.Devices.Radios.RadioState]::On }
      $access = Await ($target[0].SetStateAsync($state)) ([Windows.Devices.Radios.RadioAccessStatus])
      if ([string]$access -ne 'Allowed') { throw "Windows refused the radio change: $access" }
      for ($i = 0; $i -lt 20 -and $target[0].State -ne $state; $i++) { Start-Sleep -Milliseconds 100 }
      $radios = $target
    }
    $result = @($radios | Where-Object { [string]$_.Kind -in @('WiFi', 'Bluetooth') } | ForEach-Object { @{ name = $_.Name; kind = [string]$_.Kind; state = [string]$_.State } })
  } else { throw 'Unsupported device operation.' }
  @{ ok = $true; items = @($result) } | ConvertTo-Json -Depth 6 -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
