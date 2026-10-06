package de.hajimepro.client;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Selbst-Update der App: lädt die neue APK vom Hallen-Server, prüft die SHA-256-Prüfsumme aus dessen version.json und
 * öffnet den Android-Installationsdialog. Installieren muss der Nutzer bestätigen (Android erlaubt keine stille
 * Installation ohne Geräteverwaltung); ob die APK zur App passt (gleiche Signatur), prüft Android selbst.
 *
 * Aufruf aus der Web-Schicht: Capacitor.registerPlugin('AppUpdate').installiere({ url, sha256 })
 * Ergebnis: { status: 'installer' } (Dialog geöffnet) oder { status: 'erlaubnis' } (Nutzer muss erst
 * "Installation unbekannter Apps" für diese App erlauben; die Einstellungsseite wurde geöffnet).
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    @PluginMethod
    public void installiere(PluginCall call) {
        final String url = call.getString("url");
        final String sha256 = call.getString("sha256");
        if (url == null || sha256 == null) {
            call.reject("url und sha256 sind erforderlich");
            return;
        }
        new Thread(() -> {
            try {
                File ordner = new File(getContext().getCacheDir(), "updates");
                ordner.mkdirs();
                File[] alte = ordner.listFiles();
                if (alte != null) for (File datei : alte) datei.delete();
                File ziel = new File(ordner, "hajime-update.apk");

                HttpURLConnection verbindung = (HttpURLConnection) new URL(url).openConnection();
                verbindung.setConnectTimeout(10000);
                verbindung.setReadTimeout(30000);
                if (verbindung.getResponseCode() != 200) throw new IOException("Server antwortet mit HTTP " + verbindung.getResponseCode());
                MessageDigest hash = MessageDigest.getInstance("SHA-256");
                try (InputStream ein = verbindung.getInputStream(); FileOutputStream aus = new FileOutputStream(ziel)) {
                    byte[] puffer = new byte[64 * 1024];
                    int n;
                    while ((n = ein.read(puffer)) > 0) {
                        aus.write(puffer, 0, n);
                        hash.update(puffer, 0, n);
                    }
                } finally {
                    verbindung.disconnect();
                }
                StringBuilder hex = new StringBuilder();
                for (byte b : hash.digest()) hex.append(String.format("%02x", b));
                if (!hex.toString().equalsIgnoreCase(sha256)) {
                    ziel.delete();
                    throw new IOException("Prüfsumme der geladenen Datei stimmt nicht");
                }

                JSObject ergebnis = new JSObject();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    Intent erlaubnis = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                    erlaubnis.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(erlaubnis);
                    ergebnis.put("status", "erlaubnis");
                    call.resolve(ergebnis);
                    return;
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", ziel);
                Intent installieren = new Intent(Intent.ACTION_VIEW);
                installieren.setDataAndType(uri, "application/vnd.android.package-archive");
                installieren.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(installieren);
                ergebnis.put("status", "installer");
                call.resolve(ergebnis);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }).start();
    }
}
