import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const desktopDir = NodePath.resolve(__dirname, "..");
const mainJs = NodePath.resolve(desktopDir, "dist-electron/boot.cjs");
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone launcher has no Effect runtime.
const hostPlatform = NodeOS.platform();
const isLinux = hostPlatform === "linux";
const isWindows = hostPlatform === "win32";
const startupTimeoutMs = 30_000;
const cleanupTimeoutMs = 8_000;
const fatalPatterns = [
  "Cannot find module",
  "MODULE_NOT_FOUND",
  "Refused to execute",
  "Uncaught Error",
  "Uncaught TypeError",
  "Uncaught ReferenceError",
  "fatal startup",
];
// Electron's "app ready" precedes menu, updates, URL registration and bootstrap.
// Fresh private settings enable the primary backend; wait for its window and
// control socket too, rather than accepting the early Electron lifecycle event.
const readinessPatterns = ["app ready", "desktop app control socket ready", "main window created"];
// Do not start any application descendants before the initial ownership snapshot.
// exec preserves the detached launch PID/group once observation permits startup.
const posixLaunchGate = 'IFS= read -r gate && [ "$gate" = launch ] || exit 1; exec "$@"';
// A private child DACL cannot prevent a shared parent's delete-child access.
// Validate the known-folder ancestry before atomically creating the private leaf.
const windowsScratchSetup = String.raw`
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try {
  $user = $identity.User
  $parentPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  if ([string]::IsNullOrWhiteSpace($parentPath) -or
      [IO.Path]::GetPathRoot($parentPath) -notmatch '^[A-Za-z]:\\$') {
    throw 'Windows smoke requires an existing local application-data directory'
  }
  $scratchParent = [IO.DirectoryInfo]::new($parentPath)
  $installer = [Security.Principal.NTAccount]::new('NT SERVICE', 'TrustedInstaller')
  $trusted = @($user.Value, 'S-1-5-18', 'S-1-5-32-544',
    $installer.Translate([Security.Principal.SecurityIdentifier]).Value)
  $replacementRights = [int64][Security.AccessControl.FileSystemRights]::Delete -bor
    [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
    [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [Security.AccessControl.FileSystemRights]::TakeOwnership -bor
    [Security.AccessControl.FileSystemRights]::WriteData -bor
    [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
    [Security.AccessControl.FileSystemRights]::WriteAttributes -bor 0x10000000 -bor 0x40000000
  function Assert-SmokeScratchParent([IO.DirectoryInfo]$directory) {
    # Validate from the volume root inward: no unchecked ancestor may replace a checked child.
    if ($null -ne $directory.Parent) { Assert-SmokeScratchParent $directory.Parent }
    $directory.Refresh()
    if (-not $directory.Exists -or
        ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'Windows smoke scratch ancestry is missing or contains a reparse point'
    }
    $access = $directory.GetAccessControl(
      [Security.AccessControl.AccessControlSections]::Access -bor
      [Security.AccessControl.AccessControlSections]::Owner)
    $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new(
      $access.GetSecurityDescriptorBinaryForm(), 0)
    if ($null -eq $descriptor.DiscretionaryAcl -or
        $trusted -notcontains $access.GetOwner([Security.Principal.SecurityIdentifier]).Value) {
      throw 'Windows smoke scratch ancestry has an untrusted owner or unrestricted DACL'
    }
    $forbidden = $replacementRights
    # Existing ancestors may permit new sibling folders, but the scratch parent must not.
    if ($directory.FullName -eq $scratchParent.FullName) {
      $forbidden = $forbidden -bor [Security.AccessControl.FileSystemRights]::CreateDirectories
    }
    foreach ($entry in $access.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
      if ($entry.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
          ($entry.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and
          $trusted -notcontains $entry.IdentityReference.Value -and
          $entry.IdentityReference.Value -ne 'S-1-3-4' -and
          ([int64]$entry.FileSystemRights -band $forbidden) -ne 0) {
        throw 'Windows smoke scratch ancestry permits replacement by another principal'
      }
    }
  }
  Assert-SmokeScratchParent $scratchParent
  $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
    [Security.AccessControl.InheritanceFlags]::ObjectInherit
  $security = [Security.AccessControl.DirectorySecurity]::new()
  $security.SetOwner($user)
  $security.SetAccessRuleProtection($true, $false)
  $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $user, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance,
    [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
  $root = [IO.DirectoryInfo]::new([IO.Path]::Combine(
    $scratchParent.FullName, 't3-desktop-smoke-' + [Guid]::NewGuid().ToString('N')))
  if ($root.Exists) { throw 'Windows smoke scratch root already exists' }
  $root.Create($security)
  $root.Refresh()
  if (($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Windows smoke scratch root is a reparse point'
  }
  $actual = $root.GetAccessControl(
    [Security.AccessControl.AccessControlSections]::Access -bor
    [Security.AccessControl.AccessControlSections]::Owner)
  $rules = $actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
  if (-not $actual.AreAccessRulesProtected -or
      $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user.Value -or
      $rules.Count -ne 1) { throw 'Windows smoke scratch owner-only ACL verification failed' }
  $rule = $rules[0]
  if ($rule.IsInherited -or $rule.IdentityReference.Value -ne $user.Value -or
      $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
      $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
      $rule.InheritanceFlags -ne $inheritance -or
      $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) {
    throw 'Windows smoke scratch inheritable user-only access verification failed'
  }
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  [Console]::WriteLine($root.FullName)
} finally {
  $identity.Dispose()
}
`;
// Chromium's Unix socket paths must fit sun_path; inherited TMPDIR may be too long.
const scratch = isWindows
  ? NodeChildProcess.execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", windowsScratchSetup],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        timeout: 10_000,
      },
    ).trim()
  : NodeFS.mkdtempSync(NodePath.join("/tmp", "t3-desktop-smoke-"));
const stateDir = NodePath.join(scratch, "state");
const logPath = NodePath.join(scratch, "output.log");
const inspectionLogPath = NodePath.join(scratch, "processes.log");
const windowsStopPath = NodePath.join(stateDir, "stop-windows-job");
const windowsProofPath = NodePath.join(scratch, "windows-job-cleanup.json");
// Atomically assign suspended Electron to a non-breakaway, kill-on-close Job
// Object during creation. Kernel membership survives unobserved parent exits;
// PowerShell/.NET are built into supported Windows installations.
const windowsSupervisor = String.raw`
$ErrorActionPreference = 'Stop'
$config = $env:T3CODE_SMOKE_WINDOWS_CONFIG | ConvertFrom-Json
Remove-Item Env:T3CODE_SMOKE_WINDOWS_CONFIG
# Contain the supervisor before Add-Type: Windows PowerShell's managed compiler
# may itself spawn csc.exe. Reflection.Emit requires no compiler subprocess.
$assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly(
  [Reflection.AssemblyName]::new('DesktopSmokeBootstrap'),
  [Reflection.Emit.AssemblyBuilderAccess]::Run)
$module = $assembly.DefineDynamicModule('DesktopSmokeBootstrap')
$bootstrapType = $module.DefineType('DesktopSmokeBootstrap', [Reflection.TypeAttributes]::Public)
function Define-SmokeNative([string]$name, [Type]$returns, [Type[]]$parameters) {
  $method = $bootstrapType.DefinePInvokeMethod(
    $name, 'kernel32.dll', $name,
    [Reflection.MethodAttributes]::Public -bor [Reflection.MethodAttributes]::Static,
    [Reflection.CallingConventions]::Standard, $returns, $parameters,
    [Runtime.InteropServices.CallingConvention]::Winapi,
    [Runtime.InteropServices.CharSet]::Unicode)
  $method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
}
Define-SmokeNative 'CreateJobObjectW' ([IntPtr]) ([Type[]]@([IntPtr], [IntPtr]))
Define-SmokeNative 'SetInformationJobObject' ([bool]) ([Type[]]@([IntPtr], [int], [IntPtr], [uint32]))
Define-SmokeNative 'AssignProcessToJobObject' ([bool]) ([Type[]]@([IntPtr], [IntPtr]))
Define-SmokeNative 'GetCurrentProcess' ([IntPtr]) ([Type[]]@())
$bootstrap = $bootstrapType.CreateType()
$supervisorJob = $bootstrap.GetMethod('CreateJobObjectW').Invoke($null, @([IntPtr]::Zero, [IntPtr]::Zero))
if ($supervisorJob -eq [IntPtr]::Zero) { throw 'Could not create supervisor Job Object' }
# WinSDK JOBOBJECT_EXTENDED_LIMIT_INFORMATION is 144 bytes on x64, 112 on x86;
# BasicLimitInformation.LimitFlags is at byte 16 in both layouts.
$limitSize = if ([IntPtr]::Size -eq 8) { 144 } else { 112 }
$limitBuffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($limitSize)
try {
  [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($limitSize), 0, $limitBuffer, $limitSize)
  [Runtime.InteropServices.Marshal]::WriteInt32($limitBuffer, 16, 0x2000)
  $configured = $bootstrap.GetMethod('SetInformationJobObject').Invoke(
    $null, @($supervisorJob, [int]9, $limitBuffer, [uint32]$limitSize))
  if (-not $configured) { throw 'Could not configure supervisor kill-on-close containment' }
} finally {
  [Runtime.InteropServices.Marshal]::FreeHGlobal($limitBuffer)
}
$currentProcess = $bootstrap.GetMethod('GetCurrentProcess').Invoke($null, @())
$contained = $bootstrap.GetMethod('AssignProcessToJobObject').Invoke(
  $null, @($supervisorJob, $currentProcess))
if (-not $contained) { throw 'Could not contain supervisor before compiling the smoke helper' }
# Keep this non-inheritable handle open until process exit; its closure also
# kills compiler/helper descendants when the original Node child handle is killed.

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class DesktopSmokeJob {
  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimits {
    public long ProcessTime, JobTime;
    public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters {
    public ulong ReadOperations, WriteOperations, OtherOperations;
    public ulong ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimits {
    public BasicLimits Basic;
    public IoCounters Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct Accounting {
    public long TotalUser, TotalKernel, PeriodUser, PeriodKernel;
    public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct StartupInfo {
    public uint Size;
    public string Reserved, Desktop, Title;
    public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
    public ushort ShowWindow, ReservedSize;
    public IntPtr ReservedPointer, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct StartupInfoEx {
    public StartupInfo Startup;
    public IntPtr Attributes;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInfo {
    public IntPtr Process, Thread;
    public uint ProcessId, ThreadId;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting accounting, uint size, IntPtr returned);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool InitializeProcThreadAttributeList(IntPtr attributes, int count, uint flags, ref UIntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool UpdateProcThreadAttribute(IntPtr attributes, uint flags, IntPtr attribute, IntPtr value, UIntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")]
  static extern void DeleteProcThreadAttributeList(IntPtr attributes);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")]
  static extern IntPtr GetStdHandle(int handle);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);

  static void Check(bool success, string operation) {
    if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
  }
  public static uint Active(IntPtr job) {
    Accounting accounting;
    Check(QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero), "Query smoke Job Object");
    return accounting.ActiveProcesses;
  }
  static void AppendQuoted(StringBuilder result, string value) {
    result.Append('"');
    int slashes = 0;
    foreach (char character in value) {
      if (character == '\\') { slashes++; continue; }
      result.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
      result.Append(character);
      slashes = 0;
    }
    result.Append('\\', slashes * 2);
    result.Append('"');
  }
  public static int Run(string executable, string[] arguments, string directory, string stopPath, string proofPath, int maximumLifetimeMs) {
    if (File.Exists(stopPath)) {
      File.WriteAllText(proofPath, "{\"activeProcesses\":0}");
      return 1;
    }
    IntPtr job = IntPtr.Zero;
    IntPtr attributes = IntPtr.Zero;
    IntPtr jobList = IntPtr.Zero;
    bool attributesInitialized = false;
    ProcessInfo process = new ProcessInfo();
    try {
      job = CreateJobObjectW(IntPtr.Zero, null);
      Check(job != IntPtr.Zero, "Create smoke Job Object");
      ExtendedLimits limits = new ExtendedLimits();
      limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway flags.
      Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))), "Configure smoke Job Object");
      UIntPtr attributeSize = UIntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
      Check(attributeSize != UIntPtr.Zero, "Size smoke process attributes");
      attributes = Marshal.AllocHGlobal(checked((int)attributeSize.ToUInt64()));
      Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref attributeSize), "Initialize smoke process attributes");
      attributesInitialized = true;
      jobList = Marshal.AllocHGlobal(IntPtr.Size);
      Marshal.WriteIntPtr(jobList, job);
      // PROC_THREAD_ATTRIBUTE_JOB_LIST: atomic assignment during CreateProcess,
      // not a suspended-but-uncontained interval vulnerable to supervisor death.
      Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x0002000D), jobList, new UIntPtr((uint)IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "Set atomic smoke Job Object assignment");
      StartupInfoEx startup = new StartupInfoEx();
      startup.Startup.Size = (uint)Marshal.SizeOf(typeof(StartupInfoEx));
      startup.Startup.Flags = 0x100; // STARTF_USESTDHANDLES.
      startup.Startup.Input = GetStdHandle(-10);
      startup.Startup.Output = GetStdHandle(-11);
      startup.Startup.Error = GetStdHandle(-12);
      startup.Attributes = attributes;
      StringBuilder command = new StringBuilder();
      AppendQuoted(command, executable);
      foreach (string argument in arguments) {
        command.Append(" ");
        AppendQuoted(command, argument);
      }
      // EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW | CREATE_SUSPENDED.
      Check(CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x08080004, IntPtr.Zero, directory, ref startup, out process), "Create atomically contained smoke Electron");
      Check(ResumeThread(process.Thread) != 0xffffffff, "Resume contained smoke Electron");
      Stopwatch lifetime = Stopwatch.StartNew();
      bool timedOut = false;
      while (Active(job) != 0) {
        timedOut = lifetime.ElapsedMilliseconds >= maximumLifetimeMs;
        if (File.Exists(stopPath) || timedOut) {
          Check(TerminateJobObject(job, timedOut ? 124u : 143u), "Terminate smoke Job Object");
          Stopwatch teardown = Stopwatch.StartNew();
          while (Active(job) != 0 && teardown.ElapsedMilliseconds < 5000) Thread.Sleep(100);
          if (Active(job) != 0) throw new Exception("Smoke Job Object still contains active processes");
          break;
        }
        Thread.Sleep(100);
      }
      uint code;
      Check(GetExitCodeProcess(process.Process, out code), "Read smoke Electron exit code");
      File.WriteAllText(proofPath, "{\"activeProcesses\":0}");
      return timedOut ? 124 : unchecked((int)code);
    } finally {
      // Closing the sole non-inheritable job handle kills every contained process,
      // including when querying fails or PowerShell is externally terminated.
      if (job != IntPtr.Zero) { TerminateJobObject(job, 1); CloseHandle(job); }
      if (process.Process != IntPtr.Zero) TerminateProcess(process.Process, 1);
      if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
      if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
      if (attributesInitialized) DeleteProcThreadAttributeList(attributes);
      if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
      if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
    }
  }
}
'@
$code = [DesktopSmokeJob]::Run($config.executable, [string[]]$config.arguments, $config.directory, $config.stopPath, $config.proofPath, $config.maximumLifetimeMs)
$electronProof = [IO.File]::ReadAllText($config.proofPath) | ConvertFrom-Json
$supervisorActive = [DesktopSmokeJob]::Active($supervisorJob)
# The enclosing job must contain only this supervisor before its sole,
# non-inheritable handle closes at exit. Node also observes this exact PID exit.
$proof = @{
  electronActiveProcesses = $electronProof.activeProcesses
  supervisorActiveProcesses = $supervisorActive
  supervisorPid = $PID
  supervisorKillOnClose = $true
} | ConvertTo-Json -Compress
[IO.File]::WriteAllText($config.proofPath, $proof)
if ($electronProof.activeProcesses -ne 0) { throw 'Electron Job Object is not empty' }
if ($supervisorActive -ne 1) { throw 'Supervisor Job Object still contains compiler/helper descendants' }
exit $code
`;
// Built-in Ruby/Fiddle reads libproc directly: no compiler, Apple events or GUI.
// Apple proc_info.h: PROC_PIDTBSDINFO=3, proc_bsdinfo=136 bytes on x64/arm64;
// pid/ppid at 12/16, pgid at 100, full start seconds/microseconds at 120/128.
const macProcessQuery = String.raw`
require 'fiddle'
abort 'Unsupported macOS process ABI' unless Fiddle::SIZEOF_INT == 4 &&
  Fiddle::SIZEOF_LONG_LONG == 8 && Fiddle::SIZEOF_VOIDP == 8
library = Fiddle.dlopen('/usr/lib/libproc.dylib')
info = Fiddle::Function.new(library['proc_pidinfo'],
  [Fiddle::TYPE_INT, Fiddle::TYPE_INT, Fiddle::TYPE_LONG_LONG,
   Fiddle::TYPE_VOIDP, Fiddle::TYPE_INT], Fiddle::TYPE_INT)
list = Fiddle::Function.new(library['proc_listallpids'],
  [Fiddle::TYPE_VOIDP, Fiddle::TYPE_INT], Fiddle::TYPE_INT)
buffer = "\0" * 136
query = lambda do |pid, required|
  size = info.call(pid, 3, 0, buffer, buffer.bytesize)
  if size == 0
    error = Fiddle.last_error
    next nil if error == Errno::ESRCH::Errno
    next nil if !required && [Errno::EPERM::Errno, Errno::EACCES::Errno].include?(error)
    raise "proc_pidinfo failed for PID #{pid}, errno #{error}"
  end
  raise 'Unexpected proc_bsdinfo size' unless size == buffer.bytesize
  actual_pid, parent = buffer[12, 8].unpack('L2')
  group = buffer[100, 4].unpack('L').first
  seconds, microseconds = buffer[120, 16].unpack('Q2')
  raise 'Invalid proc_bsdinfo identity' unless actual_pid == pid &&
    seconds > 0 && microseconds < 1_000_000
  [actual_pid, parent, group, seconds, microseconds]
end
raise 'Cannot query native process identities' unless query.call(Process.pid, true)
if ARGV[0] == 'all'
  pids = nil
  3.times do
    capacity = list.call(0, 0)
    raise 'Cannot size native process list' unless capacity > 0
    capacity += 32
    storage = "\0" * (capacity * 4)
    count = list.call(storage, storage.bytesize)
    raise 'Cannot read native process list' unless count > 0 && count <= capacity
    if count < capacity
      pids = storage.unpack('i*').first(count).select { |pid| pid > 0 }
      break
    end
  end
  raise 'Native process list kept growing' unless pids
  required = ARGV[1].to_s.split(',').map { |pid| Integer(pid, 10) }
  pids.each do |pid|
    entry = query.call(pid, required.include?(pid))
    puts entry.join("\t") if entry
  end
else
  entry = query.call(Integer(ARGV[0], 10), true)
  puts entry.join("\t") if entry
end
`;
const trackedProcesses = new Map();
let child;
let logFd;
let observationTimer;
let monitor;
let launchStartedAt;
let launchReturnedAt;
let launchReleased = false;
let stopObservation;
let interruptedSignal;

function queryMacProcesses(pid, timeoutMs) {
  if (hostPlatform !== "darwin") throw new Error("Native process identities require macOS");
  const required = [...trackedProcesses.keys()];
  if (child?.pid) required.push(child.pid);
  const output = NodeChildProcess.execFileSync(
    "/usr/bin/ruby",
    [
      "--disable=gems",
      "-e",
      macProcessQuery,
      "--",
      pid === undefined ? "all" : String(pid),
      required.join(","),
    ],
    {
      encoding: "utf8",
      timeout: timeoutMs,
      env: {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        HOME: NodePath.join(stateDir, "home"),
        TMPDIR: NodePath.join(stateDir, "tmp"),
        LC_ALL: "C",
      },
    },
  );
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const fields = /^(\d+)\t(\d+)\t(\d+)\t(\d+)\t(\d+)$/.exec(line);
      if (!fields) throw new Error("Invalid native macOS process identity response");
      const [, processId, parent, group, seconds, microseconds] = fields;
      return {
        pid: Number(processId),
        parent: Number(parent),
        group: Number(group),
        identity: `${seconds}:${microseconds}`,
        started: BigInt(seconds) * 1_000n + BigInt(microseconds) / 1_000n,
      };
    });
}

// The backend starts in a separate POSIX group. Retain creation identities
// across ancestor exits instead of treating the outer group as an enclosure.
function processSnapshot() {
  if (isLinux) {
    const snapshot = [];
    for (const name of NodeFS.readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = NodeFS.readFileSync(`/proc/${name}/stat`, "utf8");
        const fields = stat
          .slice(stat.lastIndexOf(")") + 2)
          .trim()
          .split(/\s+/);
        let tagged = false;
        try {
          tagged = NodeFS.readFileSync(`/proc/${name}/environ`)
            .toString()
            .split("\0")
            .includes(`T3CODE_DESKTOP_SMOKE_ROOT=${scratch}`);
        } catch (error) {
          if (!["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(error.code)) throw error;
        }
        snapshot.push({
          pid: Number(name),
          parent: Number(fields[1]),
          group: Number(fields[2]),
          identity: fields[19],
          started: BigInt(fields[19]),
          tagged,
        });
      } catch (error) {
        if (!["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(error.code)) throw error;
      }
    }
    return snapshot;
  }
  return queryMacProcesses(undefined, 3_000);
}

function remainingProcesses() {
  const snapshot = processSnapshot();
  const byPid = new Map(snapshot.map((entry) => [entry.pid, entry]));
  const owned = new Map();
  const now = BigInt(Date.now());
  for (const entry of snapshot) {
    if (entry.tagged || trackedProcesses.get(entry.pid)?.identity === entry.identity) {
      owned.set(entry.pid, entry);
    }
  }
  if (trackedProcesses.size === 0) {
    const root = byPid.get(child.pid);
    if (root) {
      const createdAt = Number(root.started);
      const tolerance = 1_000;
      if (
        root.tagged ||
        (!isLinux &&
          createdAt >= launchStartedAt - tolerance &&
          createdAt <= launchReturnedAt + tolerance)
      ) {
        owned.set(root.pid, root);
      }
    }
    if (owned.size === 0) throw new Error("Could not establish the launched process identity");
  }
  for (const [pid, tracked] of trackedProcesses) {
    const current = byPid.get(pid);
    if (current && current.identity !== tracked.identity) tracked.ancestryRetired = true;
    if (!byPid.has(pid) && tracked.missingAfter === undefined) tracked.missingAfter = now;
  }
  let added;
  do {
    added = false;
    for (const entry of snapshot) {
      if (owned.has(entry.pid)) continue;
      const parent = owned.get(entry.parent);
      const historicalParent = trackedProcesses.get(entry.parent);
      const orphanParent =
        !isLinux &&
        !byPid.has(entry.parent) &&
        historicalParent?.missingAfter !== undefined &&
        !historicalParent.ancestryRetired &&
        entry.started <= historicalParent.missingAfter
          ? historicalParent
          : undefined;
      const ancestor = parent ?? orphanParent;
      const inOwnedGroup =
        !isWindows &&
        [...owned.values()].some(
          (member) => member.group === entry.group && entry.started >= member.started,
        );
      if ((ancestor && entry.started >= ancestor.started) || inOwnedGroup) {
        owned.set(entry.pid, entry);
        added = true;
      }
    }
  } while (added);
  for (const entry of owned.values()) {
    if (
      trackedProcesses.get(entry.pid)?.identity !== entry.identity &&
      isLinux &&
      logFd !== undefined
    ) {
      try {
        // Inspect only launched processes, logging no inherited host-secret variables.
        const args = NodeFS.readFileSync(`/proc/${entry.pid}/cmdline`).toString().split("\0");
        const environment = NodeFS.readFileSync(`/proc/${entry.pid}/environ`)
          .toString()
          .split("\0");
        const isolatedEnvironment = environment.filter((value) =>
          /^(HOME|XDG_RUNTIME_DIR|XDG_CURRENT_DESKTOP|DISPLAY|DBUS_SESSION_BUS_ADDRESS|T3CODE_HOME|GVFS_DISABLE_FUSE)=/.test(
            value,
          ),
        );
        const stat = NodeFS.readFileSync(`/proc/${entry.pid}/stat`, "utf8");
        const identity = stat
          .slice(stat.lastIndexOf(")") + 2)
          .trim()
          .split(/\s+/)[19];
        if (identity !== entry.identity) continue;
        NodeFS.appendFileSync(
          inspectionLogPath,
          `Smoke process ${entry.pid}, group ${entry.group}: ${JSON.stringify(args)} ${JSON.stringify(isolatedEnvironment)}\n`,
          { mode: 0o600 },
        );
      } catch (error) {
        if (!["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(error.code)) throw error;
      }
    }
    trackedProcesses.set(entry.pid, entry);
  }
  return [...owned.values()];
}

function inspectKnownProcess(pid, timeoutMs) {
  if (isLinux) {
    try {
      const stat = NodeFS.readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat
        .slice(stat.lastIndexOf(")") + 2)
        .trim()
        .split(/\s+/);
      return { identity: fields[19], group: Number(fields[2]) };
    } catch (error) {
      if (["ENOENT", "ESRCH"].includes(error.code)) return undefined;
      throw error;
    }
  }
  return queryMacProcesses(pid, timeoutMs)[0];
}

function killUnreapedLaunchGroup() {
  // spawn(detached) creates this group. Its leader's captured PID cannot be
  // reused before Node reaps it; never signal this fallback after child exit.
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function signalProcesses(remaining, signal, deadline) {
  let failure;
  const groups = new Set(remaining.map((entry) => entry.group));
  for (const group of groups) {
    let anchored = false;
    for (const entry of remaining) {
      if (entry.group !== group) continue;
      if (Date.now() >= deadline) {
        failure ??= new Error("Known-process validation exceeded cleanup deadline");
        break;
      }
      try {
        // Targeted lookup is independent of the full discovery snapshot.
        const current = inspectKnownProcess(entry.pid, Math.min(500, deadline - Date.now()));
        if (current?.identity === entry.identity && current.group === group) {
          anchored = true;
          break;
        }
      } catch (error) {
        failure ??= error;
      }
    }
    if (!anchored) continue;
    try {
      process.kill(-group, signal);
    } catch (error) {
      if (error.code !== "ESRCH") failure ??= error;
    }
  }
  if (failure) throw failure;
}

async function cleanupWindows(deadline) {
  let failure;
  try {
    NodeFS.writeFileSync(windowsStopPath, "", { mode: 0o600 });
  } catch (error) {
    failure = error;
    // The original supervisor handle closes its sole Job Object handle.
    try {
      child.kill("SIGKILL");
    } catch (killError) {
      failure = new AggregateError([error, killError], "Could not stop Windows smoke supervisor");
    }
  }
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (child.exitCode === null && child.signalCode === null) {
    failure ??= new Error("Windows smoke supervisor exceeded cleanup deadline");
    try {
      child.kill("SIGKILL");
    } catch (error) {
      failure = new AggregateError([failure, error], "Could not kill Windows smoke supervisor");
    }
  }
  try {
    const proof = JSON.parse(NodeFS.readFileSync(windowsProofPath, "utf8"));
    if (proof.electronActiveProcesses !== 0) {
      throw new Error("Windows Electron Job Object is not empty");
    }
    if (
      proof.supervisorActiveProcesses !== 1 ||
      proof.supervisorPid !== child.pid ||
      proof.supervisorKillOnClose !== true
    ) {
      throw new Error("Windows supervisor/compiler Job Object teardown was not verified");
    }
  } catch (error) {
    failure ??= error;
    // Even a failed job query/proof must not leave the containment owner alive.
    try {
      child.kill("SIGKILL");
    } catch (killError) {
      failure = new AggregateError([failure, killError], "Windows smoke teardown failed");
    }
  }
  if (failure) throw failure;
}

async function cleanup() {
  clearInterval(monitor);
  clearTimeout(observationTimer);
  if (!child?.pid) return;
  const deadline = Date.now() + cleanupTimeoutMs;
  if (isWindows) return cleanupWindows(deadline);
  const escalateAt = Date.now() + 2_000;
  let failure;
  let discoveryFailed = false;
  let verified = false;
  let remaining = [...trackedProcesses.values()];
  do {
    const signal = Date.now() < escalateAt ? "SIGTERM" : "SIGKILL";
    if (discoveryFailed) {
      // Preserve best-effort teardown even when discovery cannot be repeated.
      try {
        killUnreapedLaunchGroup();
        child.kill(signal);
      } catch (error) {
        failure ??= error;
      }
    }
    try {
      remaining = remainingProcesses();
      verified = true;
    } catch (error) {
      discoveryFailed = true;
      verified = false;
      failure ??= error;
      remaining = [...trackedProcesses.values()];
      try {
        killUnreapedLaunchGroup();
        child.kill(signal);
      } catch (killError) {
        failure ??= killError;
      }
    }
    try {
      signalProcesses(remaining, signal, deadline);
    } catch (error) {
      failure ??= error;
      try {
        killUnreapedLaunchGroup();
        child.kill(signal);
      } catch (killError) {
        failure ??= killError;
      }
    }
    if (verified && remaining.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  if (failure || !verified || remaining.length > 0) {
    // Escalation remains reachable even if discovery failed during the first pass.
    try {
      killUnreapedLaunchGroup();
      child.kill("SIGKILL");
    } catch (error) {
      failure ??= error;
    }
    try {
      signalProcesses([...trackedProcesses.values()], "SIGKILL", Date.now() + 500);
    } catch (error) {
      failure ??= error;
    }
    throw new Error(
      `Smoke cleanup verification failed${failure ? `: ${failure.message}` : `; remaining PIDs: ${remaining.map((entry) => entry.pid).join(", ")}`}`,
      { cause: failure },
    );
  }
}

function refuseMountedState() {
  if (!isLinux) return;
  const roots = [NodePath.resolve(stateDir)];
  try {
    roots.push(NodeFS.realpathSync(stateDir));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const mounts = NodeFS.readFileSync("/proc/self/mounts", "utf8");
  for (const line of mounts.trim().split("\n")) {
    const encoded = line.split(/\s+/)[1];
    if (!encoded) throw new Error("Could not parse smoke mount inspection");
    const mountpoint = NodePath.resolve(
      encoded.replace(/\\([0-7]{3})/g, (_, octal) =>
        String.fromCharCode(Number.parseInt(octal, 8)),
      ),
    );
    if (roots.some((root) => mountpoint === root || mountpoint.startsWith(`${root}/`))) {
      throw new Error(`Refusing to delete smoke state containing mount ${mountpoint}`);
    }
  }
}

function onSignal(signal) {
  interruptedSignal = signal;
  stopObservation?.(new Error(`Smoke interrupted by ${signal}`));
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, onSignal);

console.log("\nLaunching isolated Electron smoke test...");
console.log(`Smoke stdout/stderr: ${logPath}`);

try {
  const directories = {
    HOME: "home",
    USERPROFILE: "home",
    APPDATA: "config",
    LOCALAPPDATA: "data",
    XDG_CONFIG_HOME: "config",
    XDG_DATA_HOME: "data",
    XDG_CACHE_HOME: "cache",
    XDG_STATE_HOME: "local-state",
    XDG_RUNTIME_DIR: "runtime",
    T3CODE_HOME: "t3",
    TMPDIR: "tmp",
    TMP: "tmp",
    TEMP: "tmp",
  };
  const env = { ...process.env, VITE_DEV_SERVER_URL: "", ELECTRON_ENABLE_LOGGING: "1" };
  for (const [name, directory] of Object.entries(directories)) {
    env[name] = NodePath.join(stateDir, directory);
    NodeFS.mkdirSync(env[name], { recursive: true, mode: 0o700 });
  }
  for (const name of [
    "DBUS_SESSION_BUS_ADDRESS",
    "DBUS_STARTER_ADDRESS",
    "DBUS_STARTER_BUS_TYPE",
    "XDG_CURRENT_DESKTOP",
    "XDG_SESSION_DESKTOP",
    "DESKTOP_SESSION",
    "SESSION_MANAGER",
    "WAYLAND_DISPLAY",
    "DISPLAY",
    "XAUTHORITY",
    "ELECTRON_RUN_AS_NODE",
  ])
    delete env[name];
  if (isLinux) {
    // No inherited session address: dbus-run-session supplies a private bus.
    delete env.DBUS_SYSTEM_BUS_ADDRESS;
    // Private-bus GVFS activation must not leave a stale FUSE mount in the runtime.
    env.GVFS_DISABLE_FUSE = "1";
  }
  env.T3CODE_DESKTOP_SMOKE_ROOT = scratch;

  // Use installed Electron, not a runtime downloader or macOS registration launcher.
  let electronPath;
  try {
    electronPath = NodeModule.createRequire(import.meta.url)("electron");
    NodeFS.accessSync(electronPath, NodeFS.constants.X_OK);
  } catch (error) {
    throw new Error(
      `Electron runtime is unavailable; run vp run --filter @t3tools/desktop ensure:electron first. ${error.message}`,
      { cause: error },
    );
  }
  // Fail before Electron starts if the built-in native identity helper is absent.
  if (hostPlatform === "darwin") queryMacProcesses(process.pid, 3_000);
  const args = [
    "--password-store=basic",
    `--user-data-dir=${NodePath.join(stateDir, "profile")}`,
    mainJs,
  ];
  if (isLinux) {
    const sandboxPath = NodePath.join(NodePath.dirname(electronPath), "chrome-sandbox");
    let sandboxConfigured = false;
    try {
      const stat = NodeFS.statSync(sandboxPath);
      sandboxConfigured = stat.uid === 0 && (stat.mode & 0o4777) === 0o4755;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!sandboxConfigured) args.unshift("--no-sandbox");
  }
  if (isWindows) {
    env.T3CODE_SMOKE_WINDOWS_CONFIG = JSON.stringify({
      executable: electronPath,
      arguments: args,
      directory: desktopDir,
      stopPath: windowsStopPath,
      proofPath: windowsProofPath,
      maximumLifetimeMs: startupTimeoutMs + cleanupTimeoutMs + 2_000,
    });
  }
  logFd = NodeFS.openSync(logPath, "ax", 0o600);
  launchStartedAt = Date.now();
  child = NodeChildProcess.spawn(
    isWindows ? "powershell.exe" : "/bin/sh",
    isWindows
      ? ["-NoProfile", "-NonInteractive", "-Command", windowsSupervisor]
      : [
          "-c",
          posixLaunchGate,
          "t3-desktop-smoke",
          ...(isLinux
            ? ["dbus-run-session", "--", "xvfb-run", "-a", electronPath]
            : [electronPath]),
          ...args,
        ],
    {
      cwd: desktopDir,
      stdio: [isWindows ? "ignore" : "pipe", logFd, logFd],
      env,
      detached: !isWindows,
      windowsHide: true,
    },
  );
  launchReturnedAt = Date.now();
  await new Promise((resolve, reject) => {
    stopObservation = reject;
    child.once("error", reject);
    if (!isWindows) child.stdin.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `Electron smoke exited before observation completed (code=${code}, signal=${signal})`,
        ),
      );
    });
    // Includes xvfb-run's startup delay and cold private fontconfig cache creation.
    observationTimer = setTimeout(
      () =>
        reject(new Error(`Desktop bootstrap did not become ready within ${startupTimeoutMs}ms`)),
      Math.max(0, launchStartedAt + startupTimeoutMs - Date.now()),
    );
    const observe = () => {
      try {
        if (!isWindows) {
          remainingProcesses();
          if (!launchReleased) {
            launchReleased = true;
            child.stdin.end("launch\n");
          }
        }
        const output = NodeFS.readFileSync(logPath, "utf8");
        const failures = fatalPatterns.filter((pattern) => output.includes(pattern));
        if (failures.length > 0) throw new Error(`Fatal smoke output: ${failures.join(", ")}`);
        if (readinessPatterns.every((pattern) => output.includes(pattern))) {
          if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error("Smoke launcher exited before desktop-bootstrap readiness observation");
          }
          resolve();
        }
      } catch (error) {
        reject(error);
      }
    };
    child.once("spawn", observe);
    monitor = setInterval(observe, 200);
    if (interruptedSignal) onSignal(interruptedSignal);
  });
} catch (error) {
  console.error(`\nDesktop smoke test failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
    refuseMountedState();
    // Retain output.log, but remove private application/profile state only after teardown.
    NodeFS.rmSync(stateDir, { recursive: true, force: true });
    console.log("Smoke process-tree cleanup verified.");
  } catch (error) {
    console.error(`\nDesktop smoke cleanup failed: ${error.message}`);
    process.exitCode = 1;
  }
  if (logFd !== undefined) NodeFS.closeSync(logFd);
  child?.unref();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.removeListener(signal, onSignal);
  if (interruptedSignal) {
    process.exitCode =
      interruptedSignal === "SIGINT" ? 130 : interruptedSignal === "SIGTERM" ? 143 : 129;
  }
}

if (!process.exitCode) console.log("Desktop smoke test passed.");
