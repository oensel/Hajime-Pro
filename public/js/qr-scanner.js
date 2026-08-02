export function initialisiereScanner(onScanSuccess) {
    const startScanBtn = document.getElementById('startScanBtn');
    const stopScanBtn = document.getElementById('stopScanBtn');
    const scannerContainer = document.getElementById('scannerContainer');
    const video = document.getElementById('previewVideo');

    let videoStream = null;
    let animationFrameId = null;
    const canvasElement = document.createElement('canvas');
    const canvas = canvasElement.getContext('2d', { willReadFrequently: true });

    if (!startScanBtn || !stopScanBtn || !scannerContainer || !video) return;

    startScanBtn.addEventListener('click', async () => {
        try {
            videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            video.srcObject = videoStream;
            video.setAttribute("playsinline", true);
            video.play();

            scannerContainer.style.display = 'flex';
            animationFrameId = requestAnimationFrame(tick);
        } catch (err) {
            alert("Kamera-Zugriff verweigert oder keine Webcam gefunden: " + err.message);
        }
    });

    const stopScanner = () => {
        if (videoStream) {
            videoStream.getTracks().forEach(track => track.stop());
        }
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        scannerContainer.style.display = 'none';
    };

    stopScanBtn.addEventListener('click', stopScanner);

    function tick() {
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvasElement.height = video.videoHeight;
            canvasElement.width = video.videoWidth;
            canvas.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);

            const imageData = canvas.getImageData(0, 0, canvasElement.width, canvasElement.height);

            // jsQR liest die Bildmatrix offline aus (global geladen über window Scope)
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "dontInvert",
            });

            if (code) {
                let qrString = code.data.trim();
                let parsedData = null;
                let istDokuMe = false;

                // ERKENNUNG: Ist es ein DJB / DokuMe Digitalpass?
                if (qrString.includes('qr.dokume.net') && qrString.includes('&s=')) {
                    try {
                        istDokuMe = true;
                        const urlParts = qrString.split('&s=');
                        const token = urlParts[1];
                        const tokenParts = token.split('.');

                        if (tokenParts.length >= 2) {
                            const base64Payload = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
                            const decodedPayload = atob(base64Payload);
                            parsedData = JSON.parse(decodedPayload);
                        }
                    } catch (tokenError) {
                        console.error("Fehler beim Dekodieren des DokuMe-Tokens:", tokenError);
                    }
                } else {
                    try {
                        parsedData = JSON.parse(qrString);
                    } catch (e) {
                        console.log("QR-Inhalt ist reiner Text (kein JSON):", qrString);
                    }
                }

                if (parsedData) {
                    stopScanner();
                    // Übergibt die extrahierten Daten an die Waage-Maske zurück
                    onScanSuccess(parsedData, istDokuMe);
                    return;
                }
            }
        }
        animationFrameId = requestAnimationFrame(tick);
    }
}
