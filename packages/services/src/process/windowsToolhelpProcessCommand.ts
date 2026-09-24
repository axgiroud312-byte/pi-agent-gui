// Use kernel32's process snapshot and creation FILETIME instead of Win32_Process.
// CIM can stall for 25+ seconds on a Windows runner while Pi still owns tools.
// https://learn.microsoft.com/windows/win32/api/tlhelp32/nf-tlhelp32-createtoolhelp32snapshot
// https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes
export const WINDOWS_TOOLHELP_PROCESS_COMMAND = [
  "$ErrorActionPreference = 'Stop'",
  "$source = @'",
  String.raw`using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class NativeProcessList {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PROCESSENTRY32W {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME {
        public uint Low;
        public uint High;
        public long Value { get { return ((long)High << 32) | Low; } }
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
    [DllImport("kernel32.dll", EntryPoint = "Process32FirstW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32W entry);
    [DllImport("kernel32.dll", EntryPoint = "Process32NextW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32W entry);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(IntPtr process, out FILETIME created, out FILETIME exited, out FILETIME kernel, out FILETIME user);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    public static string[] Read() {
        IntPtr snapshot = CreateToolhelp32Snapshot(0x00000002, 0);
        if (snapshot == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            var rows = new List<string>();
            var entry = new PROCESSENTRY32W();
            entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32W));
            if (!Process32FirstW(snapshot, ref entry)) throw new Win32Exception(Marshal.GetLastWin32Error());
            while (true) {
                IntPtr process = OpenProcess(0x1000, false, entry.th32ProcessID);
                if (process != IntPtr.Zero) {
                    try {
                        FILETIME created, exited, kernel, user;
                        if (GetProcessTimes(process, out created, out exited, out kernel, out user)) {
                            long ticks = DateTime.FromFileTimeUtc(created.Value).Ticks;
                            rows.Add(entry.th32ProcessID + " " + entry.th32ParentProcessID + " " + ticks);
                        }
                    } finally { CloseHandle(process); }
                }
                entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32W));
                if (!Process32NextW(snapshot, ref entry)) {
                    int error = Marshal.GetLastWin32Error();
                    if (error != 18) throw new Win32Exception(error); // ERROR_NO_MORE_FILES
                    break;
                }
            }
            return rows.ToArray();
        } finally { CloseHandle(snapshot); }
    }
}`,
  "'@",
  "[Console]::Error.WriteLine('toolhelp:boot')",
  "Add-Type -TypeDefinition $source -Language CSharp",
  "[Console]::Error.WriteLine('toolhelp:compiled')",
  "$rows = [NativeProcessList]::Read()",
  "[Console]::Error.WriteLine('toolhelp:read=' + $rows.Count)",
  "$rows",
].join("\n");
