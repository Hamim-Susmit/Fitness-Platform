"use client";

import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

type QRScannerProps = {
  onScan: (token: string) => void;
};

export default function QRScanner({ onScan }: QRScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const elementId = "qr-reader";

  useEffect(() => {
    const scanner = new Html5Qrcode(elementId);
    scannerRef.current = scanner;

    const startScanner = async () => {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          onScan(decodedText);
        },
        () => undefined
      );
    };

    startScanner();

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => undefined);
        scannerRef.current.clear().catch(() => undefined);
      }
    };
  }, [onScan]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div id={elementId} className="w-full" />
    </div>
  );
}
