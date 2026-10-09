// Kleines Hajime-Fenster für die Windows-Installation eines Server-Updates.
//
// Der Installer läuft still (/S) und ersetzt die laufende App, die dafür beendet sein muss; er braucht
// einige Minuten. Ohne dieses Fenster wäre in der Zeit nichts zu sehen. Es ist ein eigener, winziger
// PowerShell-Prozess (Windows Forms, nichts zu installieren), der unabhängig von der App läuft, die
// Laufzeit seit dem Start anzeigt und sich schließt, sobald der wartende Prozess (die cmd.exe, die den
// Installer ausführt und danach die App startet) beendet ist.
//
// Der Balken ist bewusst unbestimmt (Marquee): der stille Installer meldet keinen Fortschritt.

const FENSTER_BREITE = 460;
const FENSTER_HOEHE = 220;
const HOECHSTE_WARTEZEIT_MINUTEN = 30; // Sicherheitsnetz: das Fenster bleibt nie endlos stehen

// Text als PowerShell-Zeichenkette in einfachen Anführungszeichen ('' maskiert ein Anführungszeichen).
export function psText(text) {
    return `'${String(text).replace(/'/g, "''")}'`;
}

export function baueInstallFensterSkript({ version, exePfad, wartePid }) {
    const pid = Number(wartePid);
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('wartePid fehlt');
    return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$start = Get-Date

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Hajime Pro Server'
$form.ClientSize = New-Object System.Drawing.Size(${FENSTER_BREITE}, ${FENSTER_HOEHE})
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ControlBox = $false
$form.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#1a2744')
$form.ForeColor = [System.Drawing.Color]::White
try { $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon(${psText(exePfad)}) } catch { }

function Neues-Label($text, $y, $hoehe, $schrift, $deckkraft) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $text
    $l.Location = New-Object System.Drawing.Point(0, $y)
    $l.Size = New-Object System.Drawing.Size(${FENSTER_BREITE}, $hoehe)
    $l.TextAlign = 'MiddleCenter'
    $l.Font = $schrift
    $l.ForeColor = [System.Drawing.Color]::FromArgb($deckkraft, 255, 255, 255)
    $form.Controls.Add($l)
    return $l
}

[void](Neues-Label 'Hajime Pro Server' 30 34 (New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)) 255)
[void](Neues-Label ${psText(`Version ${version} wird installiert …`)} 70 28 (New-Object System.Drawing.Font('Segoe UI', 10.5)) 235)
$zeit = Neues-Label 'Läuft seit 0:00' 100 24 (New-Object System.Drawing.Font('Segoe UI', 9.5)) 200
[void](Neues-Label 'Bitte nicht ausschalten – der Server startet danach von selbst neu.' 160 40 (New-Object System.Drawing.Font('Segoe UI', 9)) 190)

$balken = New-Object System.Windows.Forms.ProgressBar
$balken.Style = 'Marquee'
$balken.MarqueeAnimationSpeed = 30
$balken.Size = New-Object System.Drawing.Size(260, 10)
$balken.Location = New-Object System.Drawing.Point(${(FENSTER_BREITE - 260) / 2}, 138)
$form.Controls.Add($balken)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({
    $dauer = (Get-Date) - $start
    $zeit.Text = ('Läuft seit {0}:{1:00}' -f [int][math]::Floor($dauer.TotalMinutes), $dauer.Seconds)
    $laeuft = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
    if (-not $laeuft -or $dauer.TotalMinutes -gt ${HOECHSTE_WARTEZEIT_MINUTEN}) {
        $timer.Stop()
        $form.Close()
    }
})
$timer.Start()
$form.Add_Shown({ $form.Activate() })
[void]$form.ShowDialog()
`;
}

// Liefert Programm und Argumente für child_process.spawn. Das Skript geht als -EncodedCommand (UTF-16LE,
// Base64): so gibt es keine Probleme mit Anführungszeichen, Umlauten und Leerzeichen in Pfaden.
export function baueInstallFensterBefehl({ version, exePfad, wartePid }) {
    const skript = baueInstallFensterSkript({ version, exePfad, wartePid });
    const kodiert = Buffer.from(skript, 'utf16le').toString('base64');
    return {
        programm: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', kodiert],
        skript
    };
}
