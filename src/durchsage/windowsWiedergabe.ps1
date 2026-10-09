# Spielt rohes PCM (16 kHz, 16 Bit, Mono) von stdin über das Windows-Standardgerät (winmm waveOut).
# Wird von src/durchsage/audioAusgabe.js gestartet, wenn kein ffplay nötig sein soll. Endet, wenn stdin geschlossen wird.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class HajimeWiedergabe {
    [StructLayout(LayoutKind.Sequential)]
    struct WAVEFORMATEX { public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec; public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize; }
    [StructLayout(LayoutKind.Sequential)]
    struct WAVEHDR { public IntPtr lpData; public uint dwBufferLength; public uint dwBytesRecorded; public IntPtr dwUser; public uint dwFlags; public uint dwLoops; public IntPtr lpNext; public IntPtr reserved; }

    [DllImport("winmm.dll")] static extern int waveOutOpen(out IntPtr h, int dev, ref WAVEFORMATEX f, IntPtr cb, IntPtr inst, int flags);
    [DllImport("winmm.dll")] static extern int waveOutPrepareHeader(IntPtr h, IntPtr hdr, int size);
    [DllImport("winmm.dll")] static extern int waveOutUnprepareHeader(IntPtr h, IntPtr hdr, int size);
    [DllImport("winmm.dll")] static extern int waveOutWrite(IntPtr h, IntPtr hdr, int size);
    [DllImport("winmm.dll")] static extern int waveOutReset(IntPtr h);
    [DllImport("winmm.dll")] static extern int waveOutClose(IntPtr h);

    const int WAVE_MAPPER = -1;
    const uint WHDR_DONE = 1;
    const int ANZAHL = 8;      // Ringpuffer: 8 x 40 ms
    const int GROESSE = 1280;  // 40 ms bei 16 kHz / 16 Bit / Mono

    public static int Lauf() {
        var f = new WAVEFORMATEX { wFormatTag = 1, nChannels = 1, nSamplesPerSec = 16000, nAvgBytesPerSec = 32000, nBlockAlign = 2, wBitsPerSample = 16, cbSize = 0 };
        IntPtr h;
        if (waveOutOpen(out h, WAVE_MAPPER, ref f, IntPtr.Zero, IntPtr.Zero, 0) != 0) { Console.Error.WriteLine("Kein Audioausgang verfuegbar"); return 2; }
        int hdrGroesse = Marshal.SizeOf(typeof(WAVEHDR));
        var kopf = new IntPtr[ANZAHL];
        var daten = new IntPtr[ANZAHL];
        var benutzt = new bool[ANZAHL];
        for (int i = 0; i < ANZAHL; i++) {
            daten[i] = Marshal.AllocHGlobal(GROESSE);
            kopf[i] = Marshal.AllocHGlobal(hdrGroesse);
        }
        var eingang = Console.OpenStandardInput();
        var puffer = new byte[GROESSE];
        int flagOffset = (int)Marshal.OffsetOf(typeof(WAVEHDR), "dwFlags");
        try {
            while (true) {
                int gelesen = 0;
                while (gelesen < GROESSE) {
                    int n = eingang.Read(puffer, gelesen, GROESSE - gelesen);
                    if (n <= 0) break;
                    gelesen += n;
                }
                if (gelesen == 0) break;
                int frei = -1;
                while (frei < 0) {
                    for (int i = 0; i < ANZAHL; i++) {
                        if (!benutzt[i] || (Marshal.ReadInt32(kopf[i], flagOffset) & WHDR_DONE) != 0) { frei = i; break; }
                    }
                    if (frei < 0) Thread.Sleep(5);
                }
                if (benutzt[frei]) waveOutUnprepareHeader(h, kopf[frei], hdrGroesse);
                Marshal.Copy(puffer, 0, daten[frei], gelesen);
                var hdr = new WAVEHDR { lpData = daten[frei], dwBufferLength = (uint)gelesen };
                Marshal.StructureToPtr(hdr, kopf[frei], false);
                waveOutPrepareHeader(h, kopf[frei], hdrGroesse);
                waveOutWrite(h, kopf[frei], hdrGroesse);
                benutzt[frei] = true;
                if (gelesen < GROESSE) break;
            }
            // Rest ausspielen lassen (höchstens ~0,5 s warten).
            for (int warten = 0; warten < 100; warten++) {
                bool offen = false;
                for (int i = 0; i < ANZAHL; i++) if (benutzt[i] && (Marshal.ReadInt32(kopf[i], flagOffset) & WHDR_DONE) == 0) offen = true;
                if (!offen) break;
                Thread.Sleep(5);
            }
        } finally {
            waveOutReset(h);
            for (int i = 0; i < ANZAHL; i++) { if (benutzt[i]) waveOutUnprepareHeader(h, kopf[i], hdrGroesse); }
            waveOutClose(h);
        }
        return 0;
    }
}
'@
exit ([HajimeWiedergabe]::Lauf())
