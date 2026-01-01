"use client";

import { QRCodeCanvas } from "qrcode.react";

type QRDisplayProps = {
  token: string | null;
  expiresInSeconds: number | null;
};

export default function QRDisplay({ token, expiresInSeconds }: QRDisplayProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
      <p className="text-sm text-slate-400">Show this QR at the front desk</p>
      <div className="mt-4 flex items-center justify-center">
        {token ? (
          <QRCodeCanvas value={token} size={220} bgColor="#0f172a" fgColor="#e2e8f0" />
        ) : (
          <div className="h-[220px] w-[220px] rounded-xl border border-dashed border-slate-700 flex items-center justify-center text-slate-500">
            No active token
          </div>
        )}
      </div>
      <p className="mt-4 text-sm text-slate-300">
        {expiresInSeconds !== null && expiresInSeconds > 0
          ? `Expires in ${expiresInSeconds}s`
          : "Tap refresh to generate a new token."}
      </p>
    </div>
  );
}
